#!/usr/bin/env bash
set -euo pipefail

FIRECRACKER_VERSION="v1.10.1"
NODE_MAJOR=20

echo "=== SandboxJS Pi Setup ==="
echo ""

# 1. Check architecture
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ]; then
  echo "ERROR: Expected aarch64, got $ARCH"
  echo "Make sure you're running a 64-bit OS on your Raspberry Pi"
  exit 1
fi
echo "[OK] Architecture: $ARCH"

# 2. Check KVM
if [ ! -e /dev/kvm ]; then
  echo "ERROR: /dev/kvm not found"
  echo "Try: sudo modprobe kvm"
  echo "If that fails, your kernel may not have KVM support enabled"
  exit 1
fi
echo "[OK] /dev/kvm exists"

# Check KVM is accessible
if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
  echo "WARN: /dev/kvm not readable/writable by current user"
  echo "Fix: sudo usermod -aG kvm $USER (then re-login)"
fi

# 3. Install Node.js 20 if not present
if command -v node &>/dev/null && node -v | grep -q "v${NODE_MAJOR}"; then
  echo "[OK] Node.js $(node -v) already installed"
else
  echo "[..] Installing Node.js ${NODE_MAJOR}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "[OK] Node.js $(node -v) installed"
fi

# 4. Install socat if not present
if command -v socat &>/dev/null; then
  echo "[OK] socat already installed"
else
  echo "[..] Installing socat..."
  sudo apt-get install -y socat
  echo "[OK] socat installed"
fi

# 5. Install Firecracker
FIRECRACKER_BIN="/usr/local/bin/firecracker"
if [ -x "$FIRECRACKER_BIN" ]; then
  echo "[OK] Firecracker already installed at $FIRECRACKER_BIN"
else
  echo "[..] Downloading Firecracker ${FIRECRACKER_VERSION} (aarch64)..."
  TMPDIR=$(mktemp -d)
  curl -fsSL "https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-aarch64.tgz" \
    | tar xz -C "$TMPDIR"
  sudo mv "$TMPDIR/release-${FIRECRACKER_VERSION}-aarch64/firecracker-${FIRECRACKER_VERSION}-aarch64" "$FIRECRACKER_BIN"
  sudo chmod +x "$FIRECRACKER_BIN"
  rm -rf "$TMPDIR"
  echo "[OK] Firecracker installed at $FIRECRACKER_BIN"
fi

# 6. Create directory structure
sudo mkdir -p /opt/sandboxjs/scripts
sudo mkdir -p /tmp/sandboxjs/firecracker
sudo chown -R "$USER:$USER" /opt/sandboxjs
sudo chown -R "$USER:$USER" /tmp/sandboxjs
echo "[OK] Directory structure created"

# 7. Summary
echo ""
echo "=== Setup Complete ==="
echo "  Architecture:  $ARCH"
echo "  KVM:           /dev/kvm"
echo "  Node.js:       $(node -v)"
echo "  Firecracker:   $($FIRECRACKER_BIN --version 2>&1 || echo 'run with sudo to check')"
echo "  socat:         $(socat -V 2>&1 | head -1)"
echo ""
echo "Next steps:"
echo "  1. cd /opt/sandboxjs && make all    # build rootfs + download kernel"
echo "  2. make test-vm                      # test a Firecracker VM"
