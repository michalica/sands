#!/usr/bin/env bash
set -euo pipefail

# Deploy SandboxJS to a GCP fleet: one API server + N workers.
#
# Usage:
#   ./deploy-gcp.sh <api-ssh-target> <worker-ssh-target>[ <worker-ssh-target>...]
#
# Example:
#   ./deploy-gcp.sh ubuntu@34.x.x.x ubuntu@34.y.y.y
#
# The script is split into two phases:
#   1. Push code + restart the API server (control plane: API + dashboard + DB).
#   2. For each worker: push code, rebuild kernel/rootfs/snapshots, restart the
#      worker daemon. Workers register with the API server on their own.

if [ $# -lt 2 ]; then
  echo "Usage: ./deploy-gcp.sh <api-ssh-target> <worker-ssh-target>..." >&2
  exit 1
fi

API_TARGET="$1"
shift
WORKER_TARGETS=("$@")

REMOTE_DIR="/opt/sandboxjs/app"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

RSYNC_EXCLUDES=(
  --exclude node_modules
  --exclude .git
  --exclude tests
  --exclude dashboard/node_modules
  --exclude dashboard/.next
  --exclude '**/.env.local'
  --exclude '**/.env'
  --exclude mcp-server/node_modules
  --exclude data
)

wait_for_bootstrap() {
  local target="$1"
  echo "[..] Waiting for SSH on ${target}..."
  until ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "$target" "true" 2>/dev/null; do
    sleep 5
  done
  echo "[..] Waiting for startup-script to finish on ${target}..."
  until ssh "$target" "test -f /var/lib/sandboxjs-bootstrapped" 2>/dev/null; do
    echo "    still bootstrapping — tail with: ssh ${target} sudo tail -f /var/log/sandboxjs-startup.log"
    sleep 10
  done
  echo "[OK] ${target} bootstrapped"
}

rsync_to() {
  local target="$1"
  echo "[..] Syncing repo to ${target}:${REMOTE_DIR}..."
  rsync -az --delete --delete-excluded "${RSYNC_EXCLUDES[@]}" "$PROJECT_DIR/" "${target}:${REMOTE_DIR}/"
}

# Build locally once — both VMs deploy the same compiled output.
echo "=== Building TypeScript locally ==="
cd "$PROJECT_DIR"
npm run build
echo ""

# ───────────────────── API server deploy ─────────────────────
echo "=== Deploying API server to ${API_TARGET} ==="
wait_for_bootstrap "$API_TARGET"
rsync_to "$API_TARGET"

API_PUBLIC_IP="${API_TARGET#*@}"

echo "[..] Installing API server dependencies..."
ssh "$API_TARGET" "cd $REMOTE_DIR && npm ci --omit=dev"

echo "[..] Building dashboard..."
ssh "$API_TARGET" "cat > $REMOTE_DIR/dashboard/.env.production <<EOF
NEXT_PUBLIC_API_URL=http://${API_PUBLIC_IP}:3000
NEXT_PUBLIC_BASE_URL=http://${API_PUBLIC_IP}:3001
BETTER_AUTH_URL=http://${API_PUBLIC_IP}:3001
DATABASE_PATH=/opt/sandboxjs/data/sandboxjs.db
EOF"
ssh "$API_TARGET" "cd $REMOTE_DIR/dashboard && npm ci && npm run build"

echo "[..] Updating API env (DASHBOARD_ORIGIN)..."
ssh "$API_TARGET" "sudo sed -i '/^DASHBOARD_ORIGIN=/d' /etc/sandboxjs.env \
  && echo 'DASHBOARD_ORIGIN=http://${API_PUBLIC_IP}:3001' | sudo tee -a /etc/sandboxjs.env >/dev/null"

echo "[..] Installing API + dashboard systemd units..."
ssh "$API_TARGET" "sudo cp $REMOTE_DIR/infra/deploy/sandboxjs-api.service /etc/systemd/system/ \
  && sudo cp $REMOTE_DIR/infra/deploy/sandboxjs-dashboard.service /etc/systemd/system/ \
  && sudo systemctl daemon-reload"

echo "[..] Restarting API + dashboard..."
ssh "$API_TARGET" "sudo systemctl enable sandboxjs-api sandboxjs-dashboard \
  && sudo systemctl restart sandboxjs-api sandboxjs-dashboard"

# ───────────────────── Worker deploy(s) ─────────────────────
for WORKER_TARGET in "${WORKER_TARGETS[@]}"; do
  echo ""
  echo "=== Deploying worker to ${WORKER_TARGET} ==="
  wait_for_bootstrap "$WORKER_TARGET"
  rsync_to "$WORKER_TARGET"

  echo "[..] Installing worker dependencies..."
  ssh "$WORKER_TARGET" "cd $REMOTE_DIR && npm ci --omit=dev"

  echo "[..] Ensuring kernel is downloaded..."
  ssh "$WORKER_TARGET" "cd $REMOTE_DIR/infra/firecracker && bash download-kernel.sh"

  echo "[..] Ensuring base rootfs is built..."
  ssh "$WORKER_TARGET" "sudo $REMOTE_DIR/infra/firecracker/build-base-rootfs.sh"

  echo "[..] Building per-template rootfs..."
  for tpl in node-22 python-3.12; do
    ssh "$WORKER_TARGET" "sudo $REMOTE_DIR/infra/firecracker/build-template.sh $tpl"
  done

  echo "[..] Building snapshots..."
  for tpl in node-22 python-3.12; do
    ssh "$WORKER_TARGET" "sudo $REMOTE_DIR/scripts/build-snapshot.sh $tpl"
  done

  echo "[..] Installing worker systemd unit..."
  ssh "$WORKER_TARGET" "sudo cp $REMOTE_DIR/infra/deploy/sandboxjs-worker.service /etc/systemd/system/ \
    && sudo systemctl daemon-reload"

  echo "[..] Restarting worker daemon..."
  ssh "$WORKER_TARGET" "sudo systemctl enable sandboxjs-worker \
    && sudo systemctl restart sandboxjs-worker"
done

# ───────────────────── Health check ─────────────────────
echo ""
echo "[..] Health check..."
sleep 3
API_OK=0
DASH_OK=0
curl -fsS "http://${API_PUBLIC_IP}:3000/health" >/dev/null && API_OK=1 || true
curl -fsS -o /dev/null "http://${API_PUBLIC_IP}:3001" && DASH_OK=1 || true

echo ""
[ $API_OK -eq 1 ] && echo "[OK] API:       http://${API_PUBLIC_IP}:3000" || echo "[WARN] API not responding"
[ $DASH_OK -eq 1 ] && echo "[OK] Dashboard: http://${API_PUBLIC_IP}:3001" || echo "[WARN] Dashboard not responding"
echo ""
echo "Workers: ${#WORKER_TARGETS[@]} deployed"
echo ""
echo "Logs:"
echo "  ssh ${API_TARGET} sudo journalctl -u sandboxjs-api -f"
echo "  ssh ${API_TARGET} sudo journalctl -u sandboxjs-dashboard -f"
for WORKER_TARGET in "${WORKER_TARGETS[@]}"; do
  echo "  ssh ${WORKER_TARGET} sudo journalctl -u sandboxjs-worker -f"
done

if [ $API_OK -eq 0 ] || [ $DASH_OK -eq 0 ]; then
  exit 1
fi
echo ""
echo "=== Deploy complete ==="
