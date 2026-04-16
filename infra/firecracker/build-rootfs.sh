#!/usr/bin/env bash
set -euo pipefail

# Download Firecracker CI Ubuntu rootfs and patch in Node.js + guest agent
# Avoids chroot apt — just copies binaries directly from the host Pi

OUTPUT="/opt/sandboxjs/rootfs.ext4"
AGENT_DIR="$(cd "$(dirname "$0")/guest-agent" && pwd)"

if [ -f "$OUTPUT" ]; then
  echo "[OK] Rootfs already exists at $OUTPUT"
  exit 0
fi

# Verify host has what we need
for cmd in node socat unsquashfs; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found on host. Run pi-setup.sh first."
    exit 1
  fi
done

ARCH="$(uname -m)"
release_url="https://github.com/firecracker-microvm/firecracker/releases"
latest_version=$(basename $(curl -fsSLI -o /dev/null -w %{url_effective} ${release_url}/latest))
CI_VERSION=${latest_version%.*}

echo "=== Building rootfs (Firecracker ${latest_version}, CI ${CI_VERSION}) ==="

TMPDIR=$(mktemp -d)
cd "$TMPDIR"

cleanup() {
  cd /
  sudo rm -rf "$TMPDIR"
}
trap cleanup EXIT

# 1. Download Ubuntu squashfs from Firecracker CI
echo "[..] Finding latest Ubuntu rootfs for ${ARCH}..."
latest_ubuntu_key=$(curl -s "http://spec.ccfc.min.s3.amazonaws.com/?prefix=firecracker-ci/$CI_VERSION/$ARCH/ubuntu-&list-type=2" \
    | grep -oP "(?<=<Key>)(firecracker-ci/$CI_VERSION/$ARCH/ubuntu-[0-9]+\.[0-9]+\.squashfs)(?=</Key>)" \
    | sort -V | tail -1)

if [ -z "$latest_ubuntu_key" ]; then
  echo "ERROR: Could not find Ubuntu rootfs in S3 bucket"
  exit 1
fi

ubuntu_version=$(basename "$latest_ubuntu_key" .squashfs | grep -oE '[0-9]+\.[0-9]+')
echo "[..] Downloading Ubuntu ${ubuntu_version} rootfs..."
curl -fsSL -o "ubuntu.squashfs" "https://s3.amazonaws.com/spec.ccfc.min/${latest_ubuntu_key}"

# 2. Extract squashfs
echo "[..] Extracting squashfs..."
sudo unsquashfs ubuntu.squashfs

# 3. Copy node and socat binaries + their libs from the host
echo "[..] Copying node binary from host..."
NODE_BIN=$(which node)
SOCAT_BIN=$(which socat)

sudo cp "$NODE_BIN" squashfs-root/usr/local/bin/node
sudo cp "$SOCAT_BIN" squashfs-root/usr/local/bin/socat

# Copy shared libraries that node and socat need
echo "[..] Copying shared libraries..."
for bin in "$NODE_BIN" "$SOCAT_BIN"; do
  ldd "$bin" 2>/dev/null | grep -oP '/\S+' | while read lib; do
    if [ -f "$lib" ]; then
      # Preserve directory structure
      sudo mkdir -p "squashfs-root$(dirname "$lib")"
      sudo cp -n "$lib" "squashfs-root${lib}" 2>/dev/null || true
    fi
  done
done

# Verify node works in the rootfs
echo "[..] Verifying node..."
sudo chroot squashfs-root /usr/local/bin/node --version

# 4. Copy guest agent
echo "[..] Installing guest agent..."
sudo mkdir -p squashfs-root/opt/agent
sudo cp "$AGENT_DIR/agent.js" squashfs-root/opt/agent/agent.js

# 5. Create systemd service for the guest agent
sudo mkdir -p squashfs-root/etc/systemd/system
sudo tee squashfs-root/etc/systemd/system/sandboxjs-agent.service > /dev/null << 'EOF'
[Unit]
Description=SandboxJS Guest Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/socat VSOCK-LISTEN:9999,reuseaddr,fork EXEC:/usr/local/bin/node /opt/agent/agent.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Enable the service by creating the symlink directly
sudo mkdir -p squashfs-root/etc/systemd/system/multi-user.target.wants
sudo ln -sf /etc/systemd/system/sandboxjs-agent.service \
  squashfs-root/etc/systemd/system/multi-user.target.wants/sandboxjs-agent.service

# 6. Create ext4 image
echo "[..] Creating ext4 image..."
sudo chown -R root:root squashfs-root
truncate -s 1G rootfs.ext4
sudo mkfs.ext4 -d squashfs-root -F rootfs.ext4

# 7. Verify and move to final location
e2fsck -fn rootfs.ext4 > /dev/null 2>&1
sudo mv rootfs.ext4 "$OUTPUT"
sudo chown "$USER:$USER" "$OUTPUT"

echo ""
echo "[OK] Rootfs: $OUTPUT (Ubuntu ${ubuntu_version} + Node.js $(node --version))"
ls -lh "$OUTPUT"
