#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://34.40.68.141:3000}"
KEY="${KEY:-TEbGfwbxWYvVHcalsNZcKwNrFgJygtUnFCSVXTEVQMYpuBBMkYZQXyqKKCUvHOfK}"

echo "=== SandboxJS smoke test ==="
echo "API: $API"
echo ""

echo "--- Create sandbox ---"
SBOX=$(curl -sS -X POST "$API/sandboxes" -H "Authorization: Bearer $KEY" | jq -r .sandboxId)
echo "Sandbox: $SBOX"
echo ""

echo "--- Execute code ---"
curl -sS -X POST "$API/sandboxes/$SBOX/execute" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"code":"console.log(\"hello from sandbox\"); console.log(40+2);"}' \
  | jq .
echo ""

echo "--- Destroy sandbox ---"
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$API/sandboxes/$SBOX" \
  -H "Authorization: Bearer $KEY")
echo "Destroyed (HTTP $HTTP)"
echo ""

echo "=== Done ==="
