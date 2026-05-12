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
apt-get install -y curl ca-certificates gnupg socat squashfs-tools git build-essential e2fsprogs xfsprogs busybox-static

# 2b. Mount the attached data disk as XFS with reflink=1 at /opt/sandboxjs.
# Reflinks make `copyFile` near-instant for the per-sandbox rootfs clones —
# 17 parallel creates land in ~1 s wall instead of ~17 s.
DATA_DISK="/dev/disk/by-id/google-sandboxjs-data"
echo "[..] Waiting for data disk to attach..."
for _ in $(seq 1 30); do
  [ -b "$DATA_DISK" ] && break
  sleep 1
done
if [ ! -b "$DATA_DISK" ]; then
  echo "ERROR: data disk $DATA_DISK never appeared"
  exit 1
fi

if ! blkid "$DATA_DISK" 2>/dev/null | grep -q 'TYPE="xfs"'; then
  echo "[..] formatting $DATA_DISK as xfs with reflink=1"
  mkfs.xfs -m reflink=1 -f "$DATA_DISK"
fi

mkdir -p /opt/sandboxjs
if ! mountpoint -q /opt/sandboxjs; then
  mount "$DATA_DISK" /opt/sandboxjs
fi

UUID=$(blkid -s UUID -o value "$DATA_DISK")
if ! grep -q "$UUID" /etc/fstab; then
  echo "UUID=$UUID /opt/sandboxjs xfs defaults 0 0" >> /etc/fstab
fi
echo "[OK] $DATA_DISK mounted at /opt/sandboxjs (xfs, reflink=1)"

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

# 5. Directories the worker daemon and snapshot builder write into.
# Everything under /opt/sandboxjs/ lives on the XFS reflink volume so that
# rootfs cloning between templates/<id>/rootfs.ext4 and chroot/<id>/root/
# is a metadata-only operation.
mkdir -p /opt/sandboxjs/{app,scripts,vms,data,base,templates,chroot}

# 6. Worker env file — shared bearer token + the control plane URL it should register with
if [ ! -f /etc/sandboxjs.env ]; then
  # Discover our own internal IP so we register with a URL the API server can dial.
  INTERNAL_IP=$(curl -fsSL -H "Metadata-Flavor: Google" \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/ip)
  umask 077
  cat > /etc/sandboxjs.env <<EOF
WORKER_AUTH_TOKEN=${WORKER_TOKEN}
WORKER_ID=${WORKER_ID}
CONTROL_PLANE_URL=${CONTROL_PLANE_URL}
WORKER_PUBLIC_URL=http://${INTERNAL_IP}:7000
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
