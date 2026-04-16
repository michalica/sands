#!/usr/bin/env bash
set -euo pipefail

# Build a minimal Alpine aarch64 rootfs with Node.js for Firecracker
# Must run on aarch64 Linux (e.g., Raspberry Pi)
# Output: /opt/sandboxjs/rootfs.ext4

ALPINE_VERSION="3.20"
ALPINE_ARCH="aarch64"
ROOTFS_SIZE_MB=512
OUTPUT="/opt/sandboxjs/rootfs.ext4"
AGENT_DIR="$(cd "$(dirname "$0")/guest-agent" && pwd)"

if [ "$(uname -m)" != "aarch64" ]; then
  echo "ERROR: Must run on aarch64"
  exit 1
fi

echo "=== Building rootfs ==="

# Create empty ext4 image
TMPDIR=$(mktemp -d)
ROOTFS_IMG="$TMPDIR/rootfs.ext4"
MOUNT_DIR="$TMPDIR/mnt"

echo "[..] Creating ${ROOTFS_SIZE_MB}MB ext4 image..."
dd if=/dev/zero of="$ROOTFS_IMG" bs=1M count=$ROOTFS_SIZE_MB status=none
mkfs.ext4 -q -F "$ROOTFS_IMG"

# Mount it
mkdir -p "$MOUNT_DIR"
sudo mount -o loop "$ROOTFS_IMG" "$MOUNT_DIR"

cleanup() {
  sudo umount "$MOUNT_DIR" 2>/dev/null || true
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

# Download and extract Alpine minirootfs
ALPINE_URL="https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VERSION}/releases/${ALPINE_ARCH}/alpine-minirootfs-${ALPINE_VERSION}.0-${ALPINE_ARCH}.tar.gz"
echo "[..] Downloading Alpine ${ALPINE_VERSION} minirootfs..."
curl -fsSL "$ALPINE_URL" | sudo tar xz -C "$MOUNT_DIR"

# Configure DNS inside chroot
sudo cp /etc/resolv.conf "$MOUNT_DIR/etc/resolv.conf"

# Install Node.js and socat inside the rootfs
echo "[..] Installing Node.js and socat..."
sudo chroot "$MOUNT_DIR" /bin/sh -c "
  apk update
  apk add --no-cache nodejs socat
  node --version
"

# Copy guest agent
echo "[..] Copying guest agent..."
sudo mkdir -p "$MOUNT_DIR/opt/agent"
sudo cp "$AGENT_DIR/agent.js" "$MOUNT_DIR/opt/agent/agent.js"

# Create init script that starts the guest agent via socat on vsock
echo "[..] Configuring init..."
sudo tee "$MOUNT_DIR/etc/init.d/agent" > /dev/null << 'INITEOF'
#!/sbin/openrc-run

name="sandboxjs-agent"
description="SandboxJS Guest Agent"

command="/usr/bin/socat"
command_args="VSOCK-LISTEN:9999,reuseaddr,fork EXEC:/usr/bin/node /opt/agent/agent.js"
command_background=true
pidfile="/run/agent.pid"

depend() {
  need localmount
}
INITEOF
sudo chmod +x "$MOUNT_DIR/etc/init.d/agent"

# Create a simple /init for Firecracker (bypasses OpenRC for faster boot)
sudo tee "$MOUNT_DIR/init" > /dev/null << 'INITEOF'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev

# Start guest agent on vsock port 9999
/usr/bin/socat VSOCK-LISTEN:9999,reuseaddr,fork EXEC:"/usr/bin/node /opt/agent/agent.js" &

# Keep init alive
while true; do sleep 3600; done
INITEOF
sudo chmod +x "$MOUNT_DIR/init"

# Unmount and move to final location
sudo umount "$MOUNT_DIR"
sudo mv "$ROOTFS_IMG" "$OUTPUT"
sudo chown "$USER:$USER" "$OUTPUT"

echo ""
echo "[OK] Rootfs built at $OUTPUT"
ls -lh "$OUTPUT"
