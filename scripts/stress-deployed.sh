#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://34.141.24.128:3000}"
KEY="${KEY:?KEY env var required — get one from scripts/seed-user.ts}"
COUNT="${COUNT:-17}"

now() { python3 -c 'import time; print(f"{time.time():.6f}")'; }
elapsed() { python3 -c "print(f'{$2 - $1:.3f}')"; }

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "=== SandboxJS stress: ${COUNT} concurrent sandboxes ==="
echo "API: $API"
echo ""

# Phase 1 — concurrent creates
echo "--- Creating ${COUNT} sandboxes in parallel ---"
T0=$(now)
for i in $(seq 1 "$COUNT"); do
  ( curl -sS -w "\n%{http_code}\n%{time_total}\n" \
       -X POST "$API/sandboxes" \
       -H "Authorization: Bearer $KEY" > "$TMPDIR/create-$i.txt" ) &
done
wait
T1=$(now)
CREATE_WALL=$(elapsed "$T0" "$T1")

SBOX_IDS=()
SUCCEEDED=0
FAILED=0
SLOWEST=0
for i in $(seq 1 "$COUNT"); do
  body=$(head -n 1 "$TMPDIR/create-$i.txt")
  code=$(sed -n '2p' "$TMPDIR/create-$i.txt")
  ttime=$(sed -n '3p' "$TMPDIR/create-$i.txt")
  if [ "$code" = "201" ]; then
    sid=$(echo "$body" | jq -r .sandboxId)
    SBOX_IDS+=("$sid")
    SUCCEEDED=$((SUCCEEDED+1))
  else
    FAILED=$((FAILED+1))
    echo "  [FAIL #$i] HTTP $code: $body" >&2
  fi
  # Track slowest with python
  SLOWEST=$(python3 -c "print(max($SLOWEST, $ttime))")
done
echo "Created: $SUCCEEDED OK / $FAILED FAIL in wall ${CREATE_WALL}s (slowest single call ${SLOWEST}s)"
echo ""

if [ "$SUCCEEDED" -eq 0 ]; then
  echo "No sandboxes succeeded; aborting."
  exit 1
fi

# Phase 2 — execute on each
echo "--- Executing on all ${SUCCEEDED} sandboxes in parallel ---"
T0=$(now)
for sid in "${SBOX_IDS[@]}"; do
  ( curl -sS -o /dev/null -X POST "$API/sandboxes/$sid/execute" \
       -H "Authorization: Bearer $KEY" \
       -H "Content-Type: application/json" \
       -d "{\"code\":\"console.log('worker '+'$sid'.slice(0,8))\"}" ) &
done
wait
T1=$(now)
EXEC_WALL=$(elapsed "$T0" "$T1")
echo "Executed on all in wall ${EXEC_WALL}s"
echo ""

# Snapshot capacity
echo "--- Capacity snapshot ---"
curl -sS "$API/sandboxes" -H "Authorization: Bearer $KEY" | jq '{count, maxCount}'
echo ""

# Phase 3 — destroy
echo "--- Destroying all in parallel ---"
T0=$(now)
for sid in "${SBOX_IDS[@]}"; do
  ( curl -sS -o /dev/null -X DELETE "$API/sandboxes/$sid" \
       -H "Authorization: Bearer $KEY" ) &
done
wait
T1=$(now)
DEST_WALL=$(elapsed "$T0" "$T1")
echo "Destroyed all in wall ${DEST_WALL}s"
echo ""

echo "=== Summary ==="
echo "  Created ${SUCCEEDED}/${COUNT} in ${CREATE_WALL}s  (slowest single: ${SLOWEST}s)"
echo "  Executed on ${SUCCEEDED}    in ${EXEC_WALL}s"
echo "  Destroyed ${SUCCEEDED}      in ${DEST_WALL}s"
