#!/bin/bash
# Install notebooklm-py CLI for the Docker agent environment.
# Idempotent — safe to call multiple times.

set -e

# Check if already installed
if command -v notebooklm &>/dev/null; then
  echo "notebooklm CLI already installed: $(notebooklm --version)"
  exit 0
fi

# Ensure Python 3 is available (Debian Bookworm has it)
if ! command -v python3 &>/dev/null; then
  echo "Installing Python 3..."
  apt-get update -qq && apt-get install -y -qq python3 python3-pip python3-venv >/dev/null 2>&1
fi

# Install notebooklm-py from PyPI
echo "Installing notebooklm-py..."
pip install --break-system-packages -q notebooklm-py 2>/dev/null \
  || pip install -q notebooklm-py

echo "notebooklm CLI installed: $(notebooklm --version)"
