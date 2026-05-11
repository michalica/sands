#!/usr/bin/env bash
set -euo pipefail

echo "[template] Node.js 22 setup"
apt-get update
apt-get install -y curl ca-certificates

# Placeholder for Node.js 22 install. For now the guest agent already depends on
# host-provided node in the base image; this script is the template-owned place
# where a fully guest-native Node install will live.
echo "Install Node.js 22 here"

