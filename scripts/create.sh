#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"
API_URL="${API_URL:-http://localhost:3000}"
RESULT=$(curl -s -X POST "$API_URL/sandboxes")
echo "$RESULT" | python3 -m json.tool
echo ""
echo "Sandbox ID: $(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['sandboxId'])")"
