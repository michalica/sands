#!/usr/bin/env bash
set -euo pipefail

# Build a minimal rootfs for a named template.
# No Ubuntu, no systemd — just what we need for the guest agent and runtime.

TEMPLATE_ID="${TEMPLATE_ID:-node-22}"
TEMPLATE_NAME="${TEMPLATE_NAME:-Node.js 22}"
TEMPLATE_RUNTIME="${TEMPLATE_RUNTIME:-node}"
TEMPLATE_PACKAGES_JSON="${TEMPLATE_PACKAGES_JSON:-[\"node\"]}"
OUTPUT="${OUTPUT_PATH:-/opt/sandboxjs/templates/${TEMPLATE_ID}/rootfs.ext4}"
AGENT_DIR="$(cd "$(dirname "$0")/guest-agent" && pwd)"
ROOTFS_SIZE_MB=150

if [ -f "$OUTPUT" ]; then
  echo "[OK] Rootfs already exists at $OUTPUT"
  exit 0
fi

# Verify host has node for the guest agent
if ! command -v node &>/dev/null; then
  echo "ERROR: node not found on host. Run pi-setup.sh first."
  exit 1
fi

echo "=== Building template '${TEMPLATE_ID}' (${TEMPLATE_NAME}) ==="
echo "Runtime: ${TEMPLATE_RUNTIME}"
echo "Output:  ${OUTPUT}"
echo "Size:    ${ROOTFS_SIZE_MB}MB"

TMPDIR=$(mktemp -d)
ROOTDIR="$TMPDIR/rootfs"
mkdir -p "$ROOTDIR"

cleanup() {
  cd /
  sudo rm -rf "$TMPDIR"
}
trap cleanup EXIT

copy_binary_with_libs() {
  local binary_path="$1"
  local target_path="${2:-$1}"

  if [ ! -f "$binary_path" ]; then
    echo "ERROR: required binary not found: $binary_path"
    exit 1
  fi

  mkdir -p "$ROOTDIR$(dirname "$target_path")"
  cp "$binary_path" "$ROOTDIR${target_path}"

  if ldd "$binary_path" &>/dev/null; then
    ldd "$binary_path" 2>/dev/null | grep -oP '/\S+' | while read -r lib; do
      if [ -f "$lib" ]; then
        mkdir -p "$ROOTDIR$(dirname "$lib")"
        cp -n "$lib" "$ROOTDIR${lib}" 2>/dev/null || true
      fi
    done
  fi
}

ensure_dynamic_linker() {
  local binary_path="$1"
  local linker
  linker=$(ldd "$binary_path" 2>/dev/null | grep 'ld-linux\|ld-musl\|ld64' | grep -oP '/\S+' | head -1 || true)
  if [ -n "${linker:-}" ] && [ -f "$linker" ]; then
    mkdir -p "$ROOTDIR$(dirname "$linker")"
    cp -n "$linker" "$ROOTDIR${linker}" 2>/dev/null || true
  fi
}

has_package() {
  python3 - "$TEMPLATE_PACKAGES_JSON" "$1" <<'PY'
import json
import sys
packages = json.loads(sys.argv[1])
needle = sys.argv[2]
raise SystemExit(0 if needle in packages else 1)
PY
}

# 1. Create minimal directory structure
echo "[..] Creating directory structure..."
mkdir -p "$ROOTDIR"/{bin,sbin,usr/local/bin,lib,lib64,proc,sys,dev,tmp,opt/agent,etc,run,var/tmp}

# 2. Copy node binary from host for the guest agent and JS templates
echo "[..] Copying node binary..."
NODE_BIN=$(which node)
copy_binary_with_libs "$NODE_BIN" "/usr/local/bin/node"
ensure_dynamic_linker "$NODE_BIN"

# 3. Copy busybox (or sh) + their shared libraries
echo "[..] Copying shell..."
if command -v busybox &>/dev/null; then
  SHELL_BIN=$(which busybox)
  cp "$SHELL_BIN" "$ROOTDIR/bin/busybox"
  for cmd in sh mount umount mkdir cat ls sleep; do
    ln -sf busybox "$ROOTDIR/bin/$cmd"
  done
else
  SHELL_BIN=/bin/sh
  cp "$SHELL_BIN" "$ROOTDIR/bin/sh"
fi

copy_binary_with_libs "$SHELL_BIN" "${SHELL_BIN}"
ensure_dynamic_linker "$SHELL_BIN"

# 4. Add runtime-specific binaries declared by the template spec.
if has_package "python3"; then
  echo "[..] Copying python3 runtime..."
  PYTHON_BIN=$(which python3)
  copy_binary_with_libs "$PYTHON_BIN" "/usr/local/bin/python3"
  ensure_dynamic_linker "$PYTHON_BIN"
fi

if has_package "python3-pip"; then
  if command -v pip3 &>/dev/null; then
    echo "[..] Copying pip3..."
    PIP_BIN=$(which pip3)
    copy_binary_with_libs "$PIP_BIN" "/usr/local/bin/pip3"
    ensure_dynamic_linker "$PIP_BIN"
  else
    echo "[WARN] python3-pip requested but pip3 is not installed on the host; skipping"
  fi
fi

# 5. Copy guest agent
echo "[..] Installing guest agent..."
cp "$AGENT_DIR/agent.js" "$ROOTDIR/opt/agent/agent.js"

# 5b. Copy socat (used by init script to bridge guest vsock -> agent Unix socket)
echo "[..] Copying socat..."
SOCAT_BIN=$(command -v socat) || { echo "ERROR: socat not on host"; exit 1; }
copy_binary_with_libs "$SOCAT_BIN" "/usr/local/bin/socat"
ensure_dynamic_linker "$SOCAT_BIN"

# 6. Create init script — agent listens on UDS, socat bridges vsock:5252 → UDS.
# Kernel boot chatter still goes to ttyS0 but nothing on the host is reading it.
cat > "$ROOTDIR/init" << 'EOF'
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
mkdir -p /tmp

# Start guest agent (creates /tmp/agent.sock).
/usr/local/bin/node /opt/agent/agent.js >/tmp/agent.log 2>&1 &

# Wait for the agent's Unix socket to appear before starting the bridge.
i=0
while [ ! -S /tmp/agent.sock ]; do
  i=$((i+1))
  if [ "$i" -gt 100 ]; then
    echo "agent did not create /tmp/agent.sock within 5s" > /dev/ttyS0
    exit 1
  fi
  sleep 0.05
done

# Bridge: each incoming vsock:5252 connection from the host is forwarded
# to /tmp/agent.sock. fork keeps socat accepting concurrent connections.
exec /usr/local/bin/socat VSOCK-LISTEN:5252,fork,reuseaddr UNIX-CONNECT:/tmp/agent.sock
EOF
chmod +x "$ROOTDIR/init"

# 7. Verify core runtimes in the rootfs
echo "[..] Verifying node in rootfs..."
sudo chroot "$ROOTDIR" /usr/local/bin/node --version

if has_package "python3"; then
  echo "[..] Verifying python3 in rootfs..."
  sudo chroot "$ROOTDIR" /usr/local/bin/python3 --version
fi

# 8. Create ext4 image
echo "[..] Creating ${ROOTFS_SIZE_MB}MB ext4 image..."
mkdir -p "$(dirname "$OUTPUT")"
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
echo "     Template: ${TEMPLATE_ID}"
echo "     Guest agent: Node.js $(node --version) + busybox init"
