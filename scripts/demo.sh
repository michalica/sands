#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"
API_URL="${API_URL:-http://localhost:3000}"

echo "=== SandboxJS Demo ==="
echo "API: $API_URL"
echo ""

# Health check
echo "--- Health Check ---"
curl -s "$API_URL/health" | python3 -m json.tool
echo ""

# Create sandbox
echo "--- Create Sandbox ---"
RESULT=$(curl -s -X POST "$API_URL/sandboxes")
ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['sandboxId'])")
echo "Sandbox ID: $ID"
echo ""

# Execute: hello world
echo "--- Execute: hello world ---"
curl -s -X POST "$API_URL/sandboxes/$ID/execute" \
  -H "Content-Type: application/json" \
  -d '{"code": "console.log(\"hello from sandbox!\")"}' \
  | python3 -m json.tool
echo ""

# Execute: math
echo "--- Execute: math ---"
curl -s -X POST "$API_URL/sandboxes/$ID/execute" \
  -H "Content-Type: application/json" \
  -d '{"code": "console.log(JSON.stringify({ pi: Math.PI, sqrt2: Math.sqrt(2) }))"}' \
  | python3 -m json.tool
echo ""

# Execute: error
echo "--- Execute: intentional error ---"
curl -s -X POST "$API_URL/sandboxes/$ID/execute" \
  -H "Content-Type: application/json" \
  -d '{"code": "throw new Error(\"boom\")"}' \
  | python3 -m json.tool
echo ""

# Get logs
echo "--- Execution Logs ---"
curl -s "$API_URL/sandboxes/$ID/logs" | python3 -m json.tool
echo ""

# Destroy
echo "--- Destroy Sandbox ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/sandboxes/$ID")
echo "Destroyed (HTTP $HTTP_CODE)"
echo ""

# Verify destroyed
echo "--- Verify Destroyed (should 404) ---"
curl -s -X POST "$API_URL/sandboxes/$ID/execute" \
  -H "Content-Type: application/json" \
  -d '{"code": "1"}' \
  | python3 -m json.tool
echo ""

echo "=== Demo Complete ==="
