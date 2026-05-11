#!/usr/bin/env bash
set -euo pipefail

# node-22 is the common base — node is already installed by build-rootfs.sh.
# No template-specific work needed.
echo "[OK] node-22 template uses base rootfs as-is"
