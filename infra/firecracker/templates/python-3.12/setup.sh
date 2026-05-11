#!/usr/bin/env bash
set -euo pipefail

echo "[template] Python 3.12 setup"
apt-get update
apt-get install -y python3 python3-pip python3-venv

python3 --version

