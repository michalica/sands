#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && source "$SCRIPT_DIR/.env"
API_URL="${API_URL:-http://localhost:3000}"
curl -s "$API_URL/health" | python3 -m json.tool
