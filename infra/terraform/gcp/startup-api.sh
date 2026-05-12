#!/usr/bin/env bash
set -euo pipefail
exec > >(tee -a /var/log/sandboxjs-startup.log) 2>&1

echo "=== SandboxJS API server bootstrap ($(date)) ==="

MARKER=/var/lib/sandboxjs-bootstrapped
if [ -f "$MARKER" ]; then
  echo "Already bootstrapped — exiting."
  exit 0
fi

NODE_MAJOR=20
SSH_USER=$(curl -fsSL -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/attributes/sandboxjs-ssh-user 2>/dev/null || echo "ubuntu")
WORKER_TOKEN=$(curl -fsSL -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/attributes/sandboxjs-worker-token 2>/dev/null || true)

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg git build-essential

# Node 20 (no KVM / Firecracker / busybox-static needed on the API server)
if ! command -v node &>/dev/null || ! node -v | grep -q "v${NODE_MAJOR}"; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi
echo "[OK] Node $(node -v)"

mkdir -p /opt/sandboxjs/{app,data}

if [ ! -f /etc/sandboxjs.env ]; then
  umask 077
  cat > /etc/sandboxjs.env <<EOF
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
WORKER_AUTH_TOKEN=${WORKER_TOKEN}
EOF
  chmod 600 /etc/sandboxjs.env
fi

if ! id "$SSH_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$SSH_USER"
fi
chown -R "$SSH_USER:$SSH_USER" /opt/sandboxjs

touch "$MARKER"
echo "=== API server bootstrap complete ($(date)) ==="
