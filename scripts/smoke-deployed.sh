#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://34.141.24.128:3000}"
KEY="${KEY:-NsHuRTHFeTieZWvppfSknxNgrDQRYKsxBKNoePhziUSfwyuEQArZypFgvLZxsQrH}"

now() { python3 -c 'import time; print(f"{time.time():.6f}")'; }
elapsed() { python3 -c "print(f'{$2 - $1:.3f}')"; }

echo "=== SandboxJS smoke test ==="
echo "API: $API"
echo ""

# --- Create sandbox (cold start) ---
echo "--- Create sandbox ---"
T0=$(now)
SBOX=$(curl -sS -X POST "$API/sandboxes" -H "Authorization: Bearer $KEY" | jq -r .sandboxId)
T1=$(now)
COLD_START=$(elapsed "$T0" "$T1")
echo "Sandbox: $SBOX"
echo "Cold start:  ${COLD_START}s"
echo ""

# --- Single execute (warm) ---
echo "--- Execute code (warm) ---"
T0=$(now)
curl -sS -X POST "$API/sandboxes/$SBOX/execute" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"code":"console.log(\"hello from sandbox\"); console.log(40+2);"}' \
  | jq .
T1=$(now)
EXEC_TIME=$(elapsed "$T0" "$T1")
echo "Execute:     ${EXEC_TIME}s"
echo ""

# --- Concurrent executes (5 in parallel) ---
# With vsock each call gets its own connection, so the 5 should overlap, not serialize.
echo "--- Concurrent executes (5 in parallel) ---"
T0=$(now)
for i in 1 2 3 4 5; do
  curl -sS -o /dev/null -X POST "$API/sandboxes/$SBOX/execute" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"console.log('worker $i'); for(let j=0;j<5e5;j++);\"}" &
done
wait
T1=$(now)
PAR_TIME=$(elapsed "$T0" "$T1")
SERIAL_ESTIMATE=$(python3 -c "print(f'{5 * $EXEC_TIME:.3f}')")
echo "5 parallel:  ${PAR_TIME}s  (would be ~${SERIAL_ESTIMATE}s if serialized)"
echo ""

# --- Destroy ---
echo "--- Destroy sandbox ---"
T0=$(now)
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$API/sandboxes/$SBOX" \
  -H "Authorization: Bearer $KEY")
T1=$(now)
DEL_TIME=$(elapsed "$T0" "$T1")
echo "Destroyed (HTTP $HTTP) in ${DEL_TIME}s"
echo ""

echo "=== Summary ==="
echo "  Cold start:   ${COLD_START}s"
echo "  Warm execute: ${EXEC_TIME}s"
echo "  5 parallel:   ${PAR_TIME}s"
echo "  Destroy:      ${DEL_TIME}s"
