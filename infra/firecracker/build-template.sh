#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: ./build-template.sh <template-id>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_ID="$1"
SETUP_SCRIPT_PATH="$SCRIPT_DIR/templates/${TEMPLATE_ID}/setup.sh"
BASE_ROOTFS_PATH="/opt/sandboxjs/base/rootfs.ext4"
OUTPUT_PATH="/opt/sandboxjs/templates/${TEMPLATE_ID}/rootfs.ext4"

if [ ! -f "$SETUP_SCRIPT_PATH" ]; then
  echo "ERROR: Template setup script not found: $SETUP_SCRIPT_PATH"
  exit 1
fi

if [ ! -f "$BASE_ROOTFS_PATH" ]; then
  echo "ERROR: Base rootfs not found: $BASE_ROOTFS_PATH"
  echo "Run ./build-base-rootfs.sh first."
  exit 1
fi

echo "[..] Building template: $TEMPLATE_ID"
echo "[..] Base rootfs: $BASE_ROOTFS_PATH"
echo "[..] Setup script: $SETUP_SCRIPT_PATH"
echo "[..] Output path: $OUTPUT_PATH"

mkdir -p "$(dirname "$OUTPUT_PATH")"
cp "$BASE_ROOTFS_PATH" "$OUTPUT_PATH"

echo ""
echo "[OK] Cloned base artifact to $OUTPUT_PATH"
echo "[..] Next step: boot a builder VM with networking, mount the copied rootfs, and run:"
echo "     $SETUP_SCRIPT_PATH"
echo "[..] Builder networking will be provisioned via:"
echo "     $SCRIPT_DIR/setup-tap-device.sh"
echo "[..] This keeps template build slow and sandbox creation fast."
