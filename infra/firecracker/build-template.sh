#!/usr/bin/env bash
set -euo pipefail

# Build a per-template rootfs by cloning the common base and running the
# template's setup.sh against it as a loopback-mounted ext4.
#
# Usage: ./build-template.sh <template-id>

if [ $# -ne 1 ]; then
  echo "Usage: ./build-template.sh <template-id>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_ID="$1"
SETUP_SCRIPT="$SCRIPT_DIR/templates/${TEMPLATE_ID}/setup.sh"
BASE_ROOTFS="/opt/sandboxjs/base/rootfs.ext4"
OUTPUT="/opt/sandboxjs/templates/${TEMPLATE_ID}/rootfs.ext4"

if [ ! -f "$SETUP_SCRIPT" ]; then
  echo "ERROR: setup script missing: $SETUP_SCRIPT"
  exit 1
fi

if [ ! -f "$BASE_ROOTFS" ]; then
  echo "ERROR: base rootfs missing at $BASE_ROOTFS"
  echo "       run ./build-base-rootfs.sh first"
  exit 1
fi

if [ -f "$OUTPUT" ]; then
  echo "[OK] Template already built at $OUTPUT (delete it to force rebuild)"
  exit 0
fi

echo "[..] Building template: $TEMPLATE_ID"
echo "     Base:   $BASE_ROOTFS"
echo "     Setup:  $SETUP_SCRIPT"
echo "     Output: $OUTPUT"

mkdir -p "$(dirname "$OUTPUT")"
cp "$BASE_ROOTFS" "$OUTPUT"

MNT=$(mktemp -d)
cleanup() {
  sudo umount "$MNT" 2>/dev/null || true
  rmdir "$MNT" 2>/dev/null || true
}
trap cleanup EXIT

sudo mount -o loop "$OUTPUT" "$MNT"

# Setup script runs with:
#   TEMPLATE_ROOT — absolute path of the mounted rootfs (writable)
#   SCRIPT_DIR    — infra/firecracker, so the setup script can source template-helpers.sh
sudo TEMPLATE_ROOT="$MNT" SCRIPT_DIR="$SCRIPT_DIR" bash "$SETUP_SCRIPT"

sudo umount "$MNT"
trap - EXIT
rmdir "$MNT"

# Sanity check the filesystem after mutation.
e2fsck -fn "$OUTPUT" > /dev/null

ACTUAL_SIZE=$(du -sh "$OUTPUT" | awk '{print $1}')
echo ""
echo "[OK] Template built: $OUTPUT ($ACTUAL_SIZE)"
