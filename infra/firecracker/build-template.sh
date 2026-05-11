#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: ./build-template.sh <template-id>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_ID="$1"
SPEC_PATH="$SCRIPT_DIR/templates/${TEMPLATE_ID}.json"
OUTPUT_PATH="/opt/sandboxjs/templates/${TEMPLATE_ID}/rootfs.ext4"

if [ ! -f "$SPEC_PATH" ]; then
  echo "ERROR: Template spec not found: $SPEC_PATH"
  exit 1
fi

echo "[..] Building template: $TEMPLATE_ID"
echo "[..] Using spec: $SPEC_PATH"
echo "[..] Output path: $OUTPUT_PATH"
echo ""
echo "This is a Tier 1 scaffold."
echo "Next implementation step is to read the JSON spec and materialize a rootfs at:"
echo "  $OUTPUT_PATH"

