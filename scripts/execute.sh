#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"
API_URL="${API_URL:-http://localhost:3000}"
ID="${1:?Usage: ./execute.sh <sandbox-id> <code>}"
CODE="${2:?Usage: ./execute.sh <sandbox-id> <code>}"

curl -s -X POST "$API_URL/sandboxes/$ID/execute" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json; print(json.dumps({'code': '''$CODE'''}))")" \
  | python3 -m json.tool
