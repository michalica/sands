#!/usr/bin/env bash
set -euo pipefail
exec > >(tee -a /var/log/sandboxjs-startup.log) 2>&1

echo "=== SandboxJS worker bootstrap ($(date)) ==="

MARKER=/var/lib/sandboxjs-bootstrapped
if [ -f "$MARKER" ]; then
  echo "Already bootstrapped — exiting."
  exit 0
fi

NODE_MAJOR=20
ARCH=$(uname -m)

meta() {
  curl -fsSL -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null || true
}

SSH_USER=$(meta sandboxjs-ssh-user)
SSH_USER="${SSH_USER:-ubuntu}"
WORKER_TOKEN=$(meta sandboxjs-worker-token)
WORKER_ID=$(meta sandboxjs-worker-id)
CONTROL_PLANE_URL=$(meta sandboxjs-control-plane-url)

# 1. KVM check (nested virt should expose this)
if [ ! -e /dev/kvm ]; then
  echo "ERROR: /dev/kvm missing. Did you enable nested virtualization on the instance?"
  exit 1
fi
echo "[OK] /dev/kvm present"

# 1b. vhost_vsock — required for Firecracker's virtio-vsock to the guest agent.
modprobe vhost_vsock || true
echo "vhost_vsock" > /etc/modules-load.d/sandboxjs-vsock.conf
if [ ! -e /dev/vhost-vsock ]; then
  echo "ERROR: /dev/vhost-vsock missing after modprobe vhost_vsock"
  exit 1
fi
echo "[OK] /dev/vhost-vsock present"

# 2. Install base packages
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg socat squashfs-tools git build-essential e2fsprogs busybox-static

# 3. Node.js 20 (needed for the worker daemon and the build-snapshot script)
if ! command -v node &>/dev/null || ! node -v | grep -q "v${NODE_MAJOR}"; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi
echo "[OK] Node $(node -v)"

# 4. Firecracker + jailer (latest release for this arch)
if [ ! -x /usr/local/bin/firecracker ]; then
  release_url="https://github.com/firecracker-microvm/firecracker/releases"
  latest=$(basename "$(curl -fsSLI -o /dev/null -w '%{url_effective}' ${release_url}/latest)")
  TMPDIR=$(mktemp -d)
  curl -fsSL "${release_url}/download/${latest}/firecracker-${latest}-${ARCH}.tgz" | tar xz -C "$TMPDIR"
  mv "$TMPDIR/release-${latest}-${ARCH}/firecracker-${latest}-${ARCH}" /usr/local/bin/firecracker
  mv "$TMPDIR/release-${latest}-${ARCH}/jailer-${latest}-${ARCH}" /usr/local/bin/jailer
  chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer
  rm -rf "$TMPDIR"
fi
echo "[OK] Firecracker $(/usr/local/bin/firecracker --version 2>&1 | head -1)"

# 5. Directories the worker daemon and snapshot builder write into
mkdir -p /opt/sandboxjs/{app,scripts,vms,data,base,templates}
mkdir -p /srv/jailer

# 6. Worker env file — shared bearer token + the control plane URL it should register with
if [ ! -f /etc/sandboxjs.env ]; then
  umask 077
  cat > /etc/sandboxjs.env <<EOF
WORKER_AUTH_TOKEN=${WORKER_TOKEN}
WORKER_ID=${WORKER_ID}
CONTROL_PLANE_URL=${CONTROL_PLANE_URL}
EOF
  chmod 600 /etc/sandboxjs.env
fi

# 7. User account for SSH and chown
if ! id "$SSH_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$SSH_USER"
fi
usermod -aG kvm "$SSH_USER" || true
chown -R "$SSH_USER:$SSH_USER" /opt/sandboxjs

touch "$MARKER"
echo "=== Worker bootstrap complete ($(date)) ==="
echo "Next: rsync the app and run the worker deploy step."
