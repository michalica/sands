#!/usr/bin/env bash
set -euo pipefail

# Deploy SandboxJS to Raspberry Pi via Tailscale
# Usage: ./deploy.sh <pi-hostname-or-ip>
#
# Example: ./deploy.sh raspberrypi
#          ./deploy.sh 100.x.x.x

PI_HOST="${1:?Usage: ./deploy.sh <pi-hostname-or-ip>}"
REMOTE_DIR="/opt/sandboxjs/app"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=== Deploying SandboxJS to ${PI_HOST} ==="

# 1. Build locally
echo "[..] Building TypeScript..."
cd "$PROJECT_DIR"
npm run build

# 2. Sync project to Pi
echo "[..] Syncing to ${PI_HOST}:${REMOTE_DIR}..."
ssh "$PI_HOST" "sudo mkdir -p $REMOTE_DIR && sudo chown \$(whoami):\$(whoami) $REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude tests \
  "$PROJECT_DIR/" "${PI_HOST}:${REMOTE_DIR}/"

# 3. Install production dependencies on Pi
echo "[..] Installing dependencies on Pi..."
ssh "$PI_HOST" "cd $REMOTE_DIR && npm ci --omit=dev"

# 4. Install systemd service
echo "[..] Installing systemd service..."
ssh "$PI_HOST" "sudo cp $REMOTE_DIR/infra/deploy/sandboxjs-api.service /etc/systemd/system/ && sudo systemctl daemon-reload"

# 5. Restart service
echo "[..] Restarting service..."
ssh "$PI_HOST" "sudo systemctl enable sandboxjs-api && sudo systemctl restart sandboxjs-api"

# 6. Verify
echo "[..] Waiting for service to start..."
sleep 2
ssh "$PI_HOST" "curl -sf http://localhost:3000/health" && echo "" || echo "WARN: Health check failed — check: ssh $PI_HOST journalctl -u sandboxjs-api -f"

echo ""
echo "=== Deploy complete ==="
echo "  API: http://${PI_HOST}:3000"
echo "  Logs: ssh ${PI_HOST} journalctl -u sandboxjs-api -f"
