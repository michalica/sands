#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_PATH="/opt/sandboxjs/base/rootfs.ext4"

echo "[..] Building base rootfs"
echo "[..] Output path: $OUTPUT_PATH"
echo "[..] Contents: guest-agent, shell, minimal runtime support"

mkdir -p "$(dirname "$OUTPUT_PATH")"

export TEMPLATE_ID="base"
export TEMPLATE_NAME="SandboxJS Base"
export TEMPLATE_RUNTIME="base"
export TEMPLATE_PACKAGES_JSON='[]'
export OUTPUT_PATH

sudo -E bash "$SCRIPT_DIR/build-rootfs.sh"

