#!/usr/bin/env bash
set -euo pipefail

# Build a minimal rootfs with just Node.js + guest agent
# No Ubuntu, no systemd — just what we need

OUTPUT="/opt/sandboxjs/rootfs.ext4"
AGENT_DIR="$(cd "$(dirname "$0")/guest-agent" && pwd)"
ROOTFS_SIZE_MB=150

if [ -f "$OUTPUT" ]; then
  echo "[OK] Rootfs already exists at $OUTPUT"
  exit 0
fi

# Verify host has node
if ! command -v node &>/dev/null; then
  echo "ERROR: node not found on host. Run pi-setup.sh first."
  exit 1
fi

echo "=== Building minimal rootfs (${ROOTFS_SIZE_MB}MB) ==="

TMPDIR=$(mktemp -d)
ROOTDIR="$TMPDIR/rootfs"
mkdir -p "$ROOTDIR"

cleanup() {
  cd /
  sudo rm -rf "$TMPDIR"
}
trap cleanup EXIT

# 1. Create minimal directory structure
echo "[..] Creating directory structure..."
mkdir -p "$ROOTDIR"/{bin,sbin,usr/local/bin,lib,lib64,proc,sys,dev,tmp,opt/agent,etc,run,var/tmp}

# 2. Copy node binary from host
echo "[..] Copying node binary..."
NODE_BIN=$(which node)
cp "$NODE_BIN" "$ROOTDIR/usr/local/bin/node"

# 3. Copy shared libraries that node needs
echo "[..] Copying shared libraries..."
ldd "$NODE_BIN" 2>/dev/null | grep -oP '/\S+' | while read lib; do
  if [ -f "$lib" ]; then
    mkdir -p "$ROOTDIR$(dirname "$lib")"
    cp -n "$lib" "$ROOTDIR${lib}" 2>/dev/null || true
  fi
done

# Also copy the dynamic linker
LINKER=$(ldd "$NODE_BIN" 2>/dev/null | grep 'ld-linux' | grep -oP '/\S+' | head -1)
if [ -n "$LINKER" ] && [ -f "$LINKER" ]; then
  mkdir -p "$ROOTDIR$(dirname "$LINKER")"
  cp -n "$LINKER" "$ROOTDIR${LINKER}" 2>/dev/null || true
fi

# 4. Copy busybox for basic shell utilities (sh, mount, etc.)
if command -v busybox &>/dev/null; then
  cp "$(which busybox)" "$ROOTDIR/bin/busybox"
  # Create essential symlinks
  for cmd in sh mount umount mkdir cat ls sleep; do
    ln -sf busybox "$ROOTDIR/bin/$cmd"
  done
else
  # Fallback: copy bash and coreutils
  cp /bin/sh "$ROOTDIR/bin/sh"
  ldd /bin/sh 2>/dev/null | grep -oP '/\S+' | while read lib; do
    if [ -f "$lib" ]; then
      mkdir -p "$ROOTDIR$(dirname "$lib")"
      cp -n "$lib" "$ROOTDIR${lib}" 2>/dev/null || true
    fi
  done
fi

# 5. Copy guest agent
echo "[..] Installing guest agent..."
cp "$AGENT_DIR/agent.js" "$ROOTDIR/opt/agent/agent.js"

# 6. Create init script — boots straight into the agent
cat > "$ROOTDIR/init" << 'EOF'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
mkdir -p /tmp

# Start guest agent on serial console
exec /usr/local/bin/node /opt/agent/agent.js < /dev/ttyS0 > /dev/ttyS0 2>/dev/null
EOF
chmod +x "$ROOTDIR/init"

# 7. Verify node works
echo "[..] Verifying node in rootfs..."
sudo chroot "$ROOTDIR" /usr/local/bin/node --version

# 8. Create ext4 image
echo "[..] Creating ${ROOTFS_SIZE_MB}MB ext4 image..."
sudo chown -R root:root "$ROOTDIR"
truncate -s "${ROOTFS_SIZE_MB}M" "$TMPDIR/rootfs.ext4"
sudo mkfs.ext4 -d "$ROOTDIR" -F "$TMPDIR/rootfs.ext4"

# 9. Verify and move
e2fsck -fn "$TMPDIR/rootfs.ext4" > /dev/null 2>&1
sudo mv "$TMPDIR/rootfs.ext4" "$OUTPUT"
sudo chown "$USER:$USER" "$OUTPUT"

ACTUAL_SIZE=$(du -sh "$OUTPUT" | awk '{print $1}')
echo ""
echo "[OK] Rootfs: $OUTPUT ($ACTUAL_SIZE)"
echo "     Contents: Node.js $(node --version) + guest agent + busybox init"
