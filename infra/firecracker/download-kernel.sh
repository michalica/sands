#!/usr/bin/env bash
set -euo pipefail

# Download a Firecracker-compatible kernel (auto-detects arch + latest version)
# Source: https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md

OUTPUT="/opt/sandboxjs/vmlinux"

if [ -f "$OUTPUT" ]; then
  echo "[OK] Kernel already exists at $OUTPUT"
  exit 0
fi

ARCH="$(uname -m)"
release_url="https://github.com/firecracker-microvm/firecracker/releases"
latest_version=$(basename $(curl -fsSLI -o /dev/null -w %{url_effective} ${release_url}/latest))
CI_VERSION=${latest_version%.*}

echo "[..] Finding latest kernel for ${ARCH} (Firecracker ${latest_version}, CI ${CI_VERSION})..."

latest_kernel_key=$(curl -s "http://spec.ccfc.min.s3.amazonaws.com/?prefix=firecracker-ci/$CI_VERSION/$ARCH/vmlinux-&list-type=2" \
    | grep -oP "(?<=<Key>)(firecracker-ci/$CI_VERSION/$ARCH/vmlinux-[0-9]+\.[0-9]+\.[0-9]{1,3})(?=</Key>)" \
    | sort -V | tail -1)

if [ -z "$latest_kernel_key" ]; then
  echo "ERROR: Could not find kernel in S3 bucket"
  echo "Tried prefix: firecracker-ci/${CI_VERSION}/${ARCH}/vmlinux-"
  exit 1
fi

echo "[..] Downloading https://s3.amazonaws.com/spec.ccfc.min/${latest_kernel_key}..."
curl -fsSL -o "$OUTPUT" "https://s3.amazonaws.com/spec.ccfc.min/${latest_kernel_key}"
chmod 644 "$OUTPUT"

echo "[OK] Kernel: $OUTPUT ($(basename $latest_kernel_key))"
ls -lh "$OUTPUT"
