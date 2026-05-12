#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"
API_URL="${API_URL:-http://34.141.24.128:3000}"
ID="${1:?Usage: ./destroy.sh <sandbox-id>}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/sandboxes/$ID")
echo "Destroyed sandbox $ID (HTTP $HTTP_CODE)"
