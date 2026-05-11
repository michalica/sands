#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: ./setup-tap-device.sh <tap-name> <host-ip/cidr> <guest-ip>"
  exit 1
fi

TAP_NAME="$1"
HOST_CIDR="$2"
GUEST_IP="$3"

echo "[..] Setting up TAP device: $TAP_NAME"
echo "[..] Host CIDR: $HOST_CIDR"
echo "[..] Guest IP:  $GUEST_IP"
echo "[..] This scaffold will become the networking primitive for builder VMs and runtime VMs."
