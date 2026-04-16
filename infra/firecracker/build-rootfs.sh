#!/usr/bin/env bash
set -euo pipefail

# Download Firecracker CI Ubuntu rootfs and patch in the guest agent + Node.js
# Source: https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md

OUTPUT="/opt/sandboxjs/rootfs.ext4"
AGENT_DIR="$(cd "$(dirname "$0")/guest-agent" && pwd)"

if [ -f "$OUTPUT" ]; then
  echo "[OK] Rootfs already exists at $OUTPUT"
  exit 0
fi

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

# 3. Set up DNS + mount points for chroot
echo "[..] Preparing chroot..."
sudo cp /etc/resolv.conf squashfs-root/etc/resolv.conf
sudo mount --bind /proc squashfs-root/proc
sudo mount --bind /sys squashfs-root/sys
sudo mount --bind /dev squashfs-root/dev

# Update cleanup to unmount
cleanup() {
  sudo umount squashfs-root/proc 2>/dev/null || true
  sudo umount squashfs-root/sys 2>/dev/null || true
  sudo umount squashfs-root/dev 2>/dev/null || true
  cd /
  sudo rm -rf "$TMPDIR"
}
trap cleanup EXIT

# 4. Install Node.js and socat into the rootfs
echo "[..] Installing Node.js and socat..."
sudo chroot squashfs-root /bin/bash -c "
  apt-get update -qq
  apt-get install -y -qq nodejs npm socat > /dev/null 2>&1 || {
    # If nodejs package is too old, use nodesource
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs socat > /dev/null 2>&1
  }
  node --version
"

# Unmount before creating image
sudo umount squashfs-root/proc squashfs-root/sys squashfs-root/dev 2>/dev/null || true

# 5. Copy guest agent
echo "[..] Installing guest agent..."
sudo mkdir -p squashfs-root/opt/agent
sudo cp "$AGENT_DIR/agent.js" squashfs-root/opt/agent/agent.js

# 6. Create init wrapper that starts the agent on boot
sudo tee squashfs-root/etc/systemd/system/sandboxjs-agent.service > /dev/null << 'EOF'
[Unit]
Description=SandboxJS Guest Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/socat VSOCK-LISTEN:9999,reuseaddr,fork EXEC:/usr/bin/node /opt/agent/agent.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo chroot squashfs-root /bin/bash -c "systemctl enable sandboxjs-agent" 2>/dev/null || true

# 7. Create ext4 image
echo "[..] Creating ext4 image..."
sudo chown -R root:root squashfs-root
truncate -s 1G rootfs.ext4
sudo mkfs.ext4 -d squashfs-root -F rootfs.ext4

# 8. Verify and move to final location
e2fsck -fn rootfs.ext4 > /dev/null 2>&1
sudo mv rootfs.ext4 "$OUTPUT"
sudo chown "$USER:$USER" "$OUTPUT"

echo ""
echo "[OK] Rootfs: $OUTPUT (Ubuntu ${ubuntu_version})"
ls -lh "$OUTPUT"
