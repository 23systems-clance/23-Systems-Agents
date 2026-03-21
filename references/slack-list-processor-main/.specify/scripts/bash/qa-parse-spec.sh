#!/usr/bin/env bash
#
# qa-parse-spec.sh - Find and validate spec path for QA framework
#
# Usage: qa-parse-spec.sh <spec-number>
# Output: JSON with spec info or error
#

set -euo pipefail

SPEC_NUMBER="${1:-}"

if [[ -z "$SPEC_NUMBER" ]]; then
  echo '{"error": "Spec number required", "usage": "qa-parse-spec.sh <spec-number>"}'
  exit 1
fi

# Validate spec number is numeric
if ! [[ "$SPEC_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "{\"error\": \"Invalid spec number: $SPEC_NUMBER\", \"hint\": \"Spec number must be numeric\"}"
  exit 1
fi

# Find specs directory (relative to repo root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SPECS_DIR="$REPO_ROOT/specs"

if [[ ! -d "$SPECS_DIR" ]]; then
  echo "{\"error\": \"Specs directory not found\", \"path\": \"$SPECS_DIR\"}"
  exit 1
fi

# Find the spec directory
SPEC_DIR=$(find "$SPECS_DIR" -maxdepth 1 -type d -name "${SPEC_NUMBER}-*" 2>/dev/null | head -1)

if [[ -z "$SPEC_DIR" ]]; then
  # List available specs for helpful error
  AVAILABLE=$(ls -d "$SPECS_DIR"/[0-9]*-* 2>/dev/null | xargs -I{} basename {} | head -10 | tr '\n' ', ' | sed 's/,$//')
  echo "{\"error\": \"Spec $SPEC_NUMBER not found\", \"available\": \"$AVAILABLE\"}"
  exit 1
fi

SPEC_PATH="$SPEC_DIR/spec.md"

if [[ ! -f "$SPEC_PATH" ]]; then
  echo "{\"error\": \"spec.md not found in $SPEC_DIR\"}"
  exit 1
fi

# Extract spec name from directory
SPEC_NAME=$(basename "$SPEC_DIR" | sed "s/^${SPEC_NUMBER}-//")

# Output JSON
cat <<EOF
{
  "specNumber": $SPEC_NUMBER,
  "specName": "$SPEC_NAME",
  "specDir": "$SPEC_DIR",
  "specPath": "$SPEC_PATH",
  "hasSpec": true
}
EOF
