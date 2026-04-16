#!/usr/bin/env bash
set -euo pipefail

# Download a Firecracker-compatible aarch64 Linux kernel
# Output: /opt/sandboxjs/vmlinux

FIRECRACKER_VERSION="v1.10.1"
OUTPUT="/opt/sandboxjs/vmlinux"

if [ -f "$OUTPUT" ]; then
  echo "[OK] Kernel already exists at $OUTPUT"
  exit 0
fi

echo "[..] Downloading aarch64 kernel for Firecracker ${FIRECRACKER_VERSION}..."

# Firecracker provides pre-built kernels in their CI artifacts
# Using the kernel from their release page
KERNEL_URL="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.10/aarch64/vmlinux-6.1"

curl -fsSL -o "$OUTPUT" "$KERNEL_URL"
chmod 644 "$OUTPUT"

echo "[OK] Kernel downloaded to $OUTPUT"
ls -lh "$OUTPUT"
