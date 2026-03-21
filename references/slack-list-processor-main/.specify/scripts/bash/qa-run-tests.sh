#!/usr/bin/env bash
#
# qa-run-tests.sh - Discover and run tests for QA framework
#
# Usage:
#   qa-run-tests.sh --spec <number>
#   qa-run-tests.sh --area <name>
#   qa-run-tests.sh --all
#
# Output: JSON with test discovery results
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SPECS_DIR="$REPO_ROOT/specs"
CACHE_DIR="$REPO_ROOT/.specify/qa-cache"

# Ensure cache directory exists
mkdir -p "$CACHE_DIR"

# Parse arguments
SCOPE=""
SPEC_NUMBER=""
AREA_NAME=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --spec)
      SCOPE="SPEC"
      SPEC_NUMBER="$2"
      shift 2
      ;;
    --area)
      SCOPE="AREA"
      AREA_NAME="$2"
      shift 2
      ;;
    --all)
      SCOPE="ALL"
      shift
      ;;
    --failed)
      SCOPE="FAILED"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$SCOPE" ]]; then
  echo '{"error": "Scope required", "usage": "qa-run-tests.sh --spec <N> | --area <name> | --all | --failed"}'
  exit 1
fi

# Function to discover tests in a spec directory
discover_tests() {
  local spec_dir="$1"
  local spec_num="$2"
  local tests_dir="$spec_dir/tests"

  local unit_tests=()
  local integration_tests=()
  local e2e_tests=()
  local manual_tests=()

  # Unit tests
  if [[ -d "$tests_dir/unit" ]]; then
    while IFS= read -r -d '' file; do
      unit_tests+=("$file")
    done < <(find "$tests_dir/unit" -name "*.test.ts" -print0 2>/dev/null)
  fi

  # Integration tests
  if [[ -d "$tests_dir/integration" ]]; then
    while IFS= read -r -d '' file; do
      integration_tests+=("$file")
    done < <(find "$tests_dir/integration" -name "*.test.ts" -print0 2>/dev/null)
  fi

  # E2E tests
  if [[ -d "$tests_dir/e2e" ]]; then
    while IFS= read -r -d '' file; do
      e2e_tests+=("$file")
    done < <(find "$tests_dir/e2e" -name "*.spec.ts" -print0 2>/dev/null)
  fi

  # Manual checklists
  if [[ -d "$tests_dir/manual" ]]; then
    while IFS= read -r -d '' file; do
      manual_tests+=("$file")
    done < <(find "$tests_dir/manual" -name "*.md" -print0 2>/dev/null)
  fi

  # Output JSON for this spec
  printf '{"specNumber":%d,"specDir":"%s","unit":%d,"integration":%d,"e2e":%d,"manual":%d,"unitFiles":[%s],"integrationFiles":[%s],"e2eFiles":[%s]}' \
    "$spec_num" \
    "$spec_dir" \
    "${#unit_tests[@]}" \
    "${#integration_tests[@]}" \
    "${#e2e_tests[@]}" \
    "${#manual_tests[@]}" \
    "$(printf '"%s",' "${unit_tests[@]}" 2>/dev/null | sed 's/,$//')" \
    "$(printf '"%s",' "${integration_tests[@]}" 2>/dev/null | sed 's/,$//')" \
    "$(printf '"%s",' "${e2e_tests[@]}" 2>/dev/null | sed 's/,$//')"
}

# Main logic based on scope
case "$SCOPE" in
  SPEC)
    SPEC_DIR=$(find "$SPECS_DIR" -maxdepth 1 -type d -name "${SPEC_NUMBER}-*" 2>/dev/null | head -1)
    if [[ -z "$SPEC_DIR" ]]; then
      echo "{\"error\": \"Spec $SPEC_NUMBER not found\"}"
      exit 1
    fi
    echo '{"scope":"SPEC","specs":['
    discover_tests "$SPEC_DIR" "$SPEC_NUMBER"
    echo ']}'
    ;;

  AREA)
    AREAS_FILE="$REPO_ROOT/.specify/qa-areas.yml"
    if [[ ! -f "$AREAS_FILE" ]]; then
      echo '{"error": "Area config not found", "path": ".specify/qa-areas.yml"}'
      exit 1
    fi

    # Extract specs for the area (simple YAML parsing)
    SPECS=$(grep -A 20 "^  $AREA_NAME:" "$AREAS_FILE" | grep -E "^\s+- [0-9]+" | head -20 | sed 's/.*- //' | tr '\n' ' ')

    if [[ -z "$SPECS" ]]; then
      # Get available areas for helpful error message
      AVAILABLE_AREAS=$(grep -E "^  [a-z]+:" "$AREAS_FILE" | sed 's/://g' | tr -d ' ' | tr '\n' ', ' | sed 's/,$//')
      echo "{\"error\": \"Area '$AREA_NAME' not found\", \"availableAreas\": \"$AVAILABLE_AREAS\"}"
      exit 1
    fi

    echo '{"scope":"AREA","areaName":"'"$AREA_NAME"'","specs":['
    first=true
    for spec_num in $SPECS; do
      SPEC_DIR=$(find "$SPECS_DIR" -maxdepth 1 -type d -name "${spec_num}-*" 2>/dev/null | head -1)
      if [[ -n "$SPEC_DIR" ]]; then
        if [[ "$first" != "true" ]]; then
          echo ","
        fi
        first=false
        discover_tests "$SPEC_DIR" "$spec_num"
      fi
    done
    echo ']}'
    ;;

  ALL)
    echo '{"scope":"ALL","specs":['
    first=true
    for spec_dir in "$SPECS_DIR"/[0-9]*-*/; do
      if [[ -d "$spec_dir" ]]; then
        spec_num=$(basename "$spec_dir" | grep -oE '^[0-9]+')
        if [[ -n "$spec_num" ]]; then
          if [[ "$first" != "true" ]]; then
            echo ","
          fi
          first=false
          discover_tests "$spec_dir" "$spec_num"
        fi
      fi
    done
    echo ']}'
    ;;

  FAILED)
    echo '{"scope":"FAILED","message":"Query database for failed tests from last run"}'
    ;;
esac
