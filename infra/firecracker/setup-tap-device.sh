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

if ! ip link show "$TAP_NAME" >/dev/null 2>&1; then
  ip tuntap add dev "$TAP_NAME" mode tap
fi

ip addr replace "$HOST_CIDR" dev "$TAP_NAME"
ip link set "$TAP_NAME" up

echo "[OK] TAP device ready: $TAP_NAME"
