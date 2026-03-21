#!/usr/bin/env bash
#
# qa-parse-spec.sh - Find and validate spec for QA framework
#
# Usage:
#   qa-parse-spec.sh <spec-number>   Find spec by number
#   qa-parse-spec.sh --current       Find spec for current feature
#   qa-parse-spec.sh --list          List all available specs
#
# Output: JSON with spec info or error
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

MODE="${1:-}"

if [[ -z "$MODE" ]]; then
  echo '{"error": "Argument required", "usage": "qa-parse-spec.sh <spec-number> | --current | --list"}'
  exit 1
fi

REPO_ROOT=$(get_repo_root)

# List mode
if [[ "$MODE" == "--list" ]]; then
  SPECS=()
  while IFS= read -r spec_path; do
    [[ -n "$spec_path" ]] && SPECS+=("\"$(basename "$spec_path")\"")
  done < <(list_all_specs)

  printf '{"specs": [%s]}\n' "$(IFS=,; echo "${SPECS[*]}")"
  exit 0
fi

# Resolve spec path
SPEC_PATH=""
SPEC_NUMBER=""

if [[ "$MODE" == "--current" ]]; then
  SPEC_PATH=$(get_feature_spec)
  if [[ -z "$SPEC_PATH" ]]; then
    CURRENT=$(get_current_feature)
    echo "{\"error\": \"No spec found for current feature\", \"currentFeature\": \"$CURRENT\"}"
    exit 1
  fi
  # Extract number from filename
  SPEC_NUMBER=$(basename "$SPEC_PATH" | grep -oE '^[0-9]+' || echo "0")
elif [[ "$MODE" =~ ^[0-9]+$ ]]; then
  SPEC_NUMBER="$MODE"
  SPEC_PATH=$(get_spec_by_number "$SPEC_NUMBER")
  if [[ -z "$SPEC_PATH" ]]; then
    AVAILABLE=$(list_all_specs | xargs -I{} basename {} | head -10 | tr '\n' ', ' | sed 's/,$//')
    echo "{\"error\": \"Spec $SPEC_NUMBER not found\", \"available\": \"$AVAILABLE\"}"
    exit 1
  fi
else
  echo "{\"error\": \"Invalid argument: $MODE\", \"usage\": \"qa-parse-spec.sh <spec-number> | --current | --list\"}"
  exit 1
fi

# Extract spec name from filename or directory
SPEC_BASENAME=$(basename "$SPEC_PATH" .md)
SPEC_NAME=$(echo "$SPEC_BASENAME" | sed -E "s/^[0-9]+-//")

# Spec directory is the parent of spec.md
SPEC_DIR=$(dirname "$SPEC_PATH")

# Count clarification markers
CLARIFY_COUNT=$(grep -c '\[NEEDS CLARIFICATION\]\|\[Gap\]\|\[Ambiguity\]\|\[Conflict\]\|\[Assumption\]' "$SPEC_PATH" 2>/dev/null || true)
CLARIFY_COUNT="${CLARIFY_COUNT:-0}"
CLARIFY_COUNT=$(echo "$CLARIFY_COUNT" | tr -d '[:space:]')

# Count sections (## headers) as a rough completeness indicator
SECTION_COUNT=$(grep -c '^## ' "$SPEC_PATH" 2>/dev/null || true)
SECTION_COUNT="${SECTION_COUNT:-0}"
SECTION_COUNT=$(echo "$SECTION_COUNT" | tr -d '[:space:]')

# Check for related documents (only meaningful for directory-based specs)
HAS_PLAN=false
HAS_TASKS=false
HAS_CHECKLISTS=false
HAS_RESEARCH=false
HAS_DATA_MODEL=false
HAS_CONTRACTS=false

if [[ "$IS_FLAT" == "false" ]]; then
  [[ -f "$SPEC_DIR/plan.md" ]] && HAS_PLAN=true
  [[ -f "$SPEC_DIR/tasks.md" ]] && HAS_TASKS=true
  [[ -d "$SPEC_DIR/checklists" ]] && HAS_CHECKLISTS=true
  [[ -f "$SPEC_DIR/research.md" ]] && HAS_RESEARCH=true
  [[ -f "$SPEC_DIR/data-model.md" ]] && HAS_DATA_MODEL=true
  [[ -d "$SPEC_DIR/contracts" ]] && HAS_CONTRACTS=true
fi

cat <<EOF
{
  "specNumber": $SPEC_NUMBER,
  "specName": "$SPEC_NAME",
  "specPath": "$SPEC_PATH",
  "specDir": "$SPEC_DIR",
  "isFlat": $IS_FLAT,
  "hasSpec": true,
  "hasPlan": $HAS_PLAN,
  "hasTasks": $HAS_TASKS,
  "hasChecklists": $HAS_CHECKLISTS,
  "hasResearch": $HAS_RESEARCH,
  "hasDataModel": $HAS_DATA_MODEL,
  "hasContracts": $HAS_CONTRACTS,
  "clarificationMarkers": $CLARIFY_COUNT,
  "sectionCount": $SECTION_COUNT
}
EOF
