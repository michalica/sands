#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"
API_URL="${API_URL:-http://localhost:3000}"
ID="${1:?Usage: ./logs.sh <sandbox-id>}"
curl -s "$API_URL/sandboxes/$ID/logs" | python3 -m json.tool
