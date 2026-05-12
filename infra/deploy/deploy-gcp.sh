#!/usr/bin/env bash
set -euo pipefail

# Deploy SandboxJS to a GCP Compute Engine VM
# Usage: ./deploy-gcp.sh <ssh-target>
#
# Example: ./deploy-gcp.sh ubuntu@34.x.x.x
#
# Prereqs (one-time, on the VM — handled by terraform startup-script):
#   - Firecracker + jailer installed
#   - Node 20 installed
#   - /opt/sandboxjs owned by the SSH user

SSH_TARGET="${1:?Usage: ./deploy-gcp.sh <ssh-target>   e.g. ubuntu@34.x.x.x}"
REMOTE_DIR="/opt/sandboxjs/app"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=== Deploying SandboxJS to ${SSH_TARGET} ==="

# 1. Build locally
echo "[..] Building TypeScript..."
cd "$PROJECT_DIR"
npm run build

# 2. Wait for SSH (startup-script may still be installing)
echo "[..] Waiting for SSH..."
until ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "$SSH_TARGET" "true" 2>/dev/null; do
  sleep 5
done

# 3. Wait for bootstrap marker (startup-script finished)
echo "[..] Waiting for VM bootstrap to finish..."
until ssh "$SSH_TARGET" "test -f /var/lib/sandboxjs-bootstrapped" 2>/dev/null; do
  echo "    still bootstrapping — tail with: ssh $SSH_TARGET sudo tail -f /var/log/sandboxjs-startup.log"
  sleep 10
done
echo "[OK] VM bootstrapped"

# 4. Sync project
echo "[..] Syncing repo to ${SSH_TARGET}:${REMOTE_DIR}..."
rsync -az --delete --delete-excluded \
  --exclude node_modules \
  --exclude .git \
  --exclude tests \
  --exclude dashboard/node_modules \
  --exclude dashboard/.next \
  --exclude '**/.env.local' \
  --exclude '**/.env' \
  --exclude mcp-server/node_modules \
  --exclude data \
  "$PROJECT_DIR/" "${SSH_TARGET}:${REMOTE_DIR}/"

PUBLIC_IP="${SSH_TARGET#*@}"

# 5. Install API production deps
echo "[..] Installing API production dependencies..."
ssh "$SSH_TARGET" "cd $REMOTE_DIR && npm ci --omit=dev"

# 6. Build kernel + rootfs (idempotent — skips if files already exist)
echo "[..] Ensuring kernel + rootfs are built..."
ssh "$SSH_TARGET" "cd $REMOTE_DIR/infra/firecracker && make all"

# 6b. Build Firecracker snapshots for each template (idempotent — manifest hash
# matches => skip). First-time cost: ~10-15s per template. Subsequent deploys
# only rebuild if the rootfs, kernel, or Firecracker binary changed.
echo "[..] Building snapshots..."
for tpl in node-22 python-3.12; do
  ssh "$SSH_TARGET" "sudo $REMOTE_DIR/scripts/build-snapshot.sh $tpl"
done

# 7. Build the dashboard on the VM
# Generate .env.production with the VM's public IP so NEXT_PUBLIC_* vars get baked in correctly.
echo "[..] Building dashboard..."
ssh "$SSH_TARGET" "cat > $REMOTE_DIR/dashboard/.env.production <<EOF
NEXT_PUBLIC_API_URL=http://${PUBLIC_IP}:3000
NEXT_PUBLIC_BASE_URL=http://${PUBLIC_IP}:3001
BETTER_AUTH_URL=http://${PUBLIC_IP}:3001
DATABASE_PATH=/opt/sandboxjs/data/sandboxjs.db
EOF"
ssh "$SSH_TARGET" "cd $REMOTE_DIR/dashboard && npm ci && npm run build"

# 8. Tell the API about the dashboard origin (for CORS)
echo "[..] Updating API env with DASHBOARD_ORIGIN..."
ssh "$SSH_TARGET" "sudo sed -i '/^DASHBOARD_ORIGIN=/d' /etc/sandboxjs.env && echo 'DASHBOARD_ORIGIN=http://${PUBLIC_IP}:3001' | sudo tee -a /etc/sandboxjs.env >/dev/null"

# 9. Install both systemd units
echo "[..] Installing systemd services..."
ssh "$SSH_TARGET" "sudo cp $REMOTE_DIR/infra/deploy/sandboxjs-api.service /etc/systemd/system/ \
  && sudo cp $REMOTE_DIR/infra/deploy/sandboxjs-dashboard.service /etc/systemd/system/ \
  && sudo systemctl daemon-reload"

# 10. Restart services
echo "[..] Restarting services..."
ssh "$SSH_TARGET" "sudo systemctl enable sandboxjs-api sandboxjs-dashboard \
  && sudo systemctl restart sandboxjs-api sandboxjs-dashboard"

# 11. Health check
echo "[..] Health check..."
sleep 3
API_OK=0
DASH_OK=0
curl -fsS "http://${PUBLIC_IP}:3000/health" >/dev/null && API_OK=1 || true
curl -fsS -o /dev/null "http://${PUBLIC_IP}:3001" && DASH_OK=1 || true

echo ""
[ $API_OK -eq 1 ] && echo "[OK] API:       http://${PUBLIC_IP}:3000" || echo "[WARN] API not responding"
[ $DASH_OK -eq 1 ] && echo "[OK] Dashboard: http://${PUBLIC_IP}:3001" || echo "[WARN] Dashboard not responding"
echo ""
echo "Logs:"
echo "  ssh ${SSH_TARGET} sudo journalctl -u sandboxjs-api -f"
echo "  ssh ${SSH_TARGET} sudo journalctl -u sandboxjs-dashboard -f"

if [ $API_OK -eq 0 ] || [ $DASH_OK -eq 0 ]; then
  exit 1
fi
echo "=== Deploy complete ==="
