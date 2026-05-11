#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=../../template-helpers.sh
source "$SCRIPT_DIR/template-helpers.sh"

if ! command -v python3 >/dev/null; then
  echo "ERROR: python3 not installed on the build host" >&2
  exit 1
fi

PYTHON_BIN=$(command -v python3)
echo "[..] Installing $PYTHON_BIN into template rootfs..."
copy_binary_into "$TEMPLATE_ROOT" "$PYTHON_BIN" "/usr/local/bin/python3"

if PIP_BIN=$(command -v pip3 2>/dev/null); then
  echo "[..] Installing $PIP_BIN into template rootfs..."
  copy_binary_into "$TEMPLATE_ROOT" "$PIP_BIN" "/usr/local/bin/pip3"
else
  echo "[WARN] pip3 not on host — skipping"
fi

# Sanity check: dynamic linker chain works inside the rootfs.
sudo chroot "$TEMPLATE_ROOT" /usr/local/bin/python3 --version

echo "[OK] python-3.12 setup complete"
