#!/bin/bash
# Check prerequisites for SpecKit commands

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

# Defaults
JSON_OUTPUT=false
PATHS_ONLY=false
REQUIRE_TASKS=false
INCLUDE_TASKS=false
INCLUDE_REFS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json|-Json)
            JSON_OUTPUT=true
            shift
            ;;
        --paths-only|-PathsOnly)
            PATHS_ONLY=true
            shift
            ;;
        --require-tasks)
            REQUIRE_TASKS=true
            shift
            ;;
        --include-tasks)
            INCLUDE_TASKS=true
            shift
            ;;
        --include-refs)
            INCLUDE_REFS=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

REPO_ROOT=$(get_repo_root)
FEATURE_DIR=$(get_feature_dir)
FEATURE_SPEC="${FEATURE_DIR}/spec.md"
IMPL_PLAN="${FEATURE_DIR}/plan.md"
TASKS="${FEATURE_DIR}/tasks.md"

# Check what documents exist
AVAILABLE_DOCS=()
[[ -f "$FEATURE_SPEC" ]] && AVAILABLE_DOCS+=("spec.md")
[[ -f "$IMPL_PLAN" ]] && AVAILABLE_DOCS+=("plan.md")
[[ -f "$TASKS" ]] && AVAILABLE_DOCS+=("tasks.md")
[[ -f "${FEATURE_DIR}/research.md" ]] && AVAILABLE_DOCS+=("research.md")
[[ -f "${FEATURE_DIR}/data-model.md" ]] && AVAILABLE_DOCS+=("data-model.md")
[[ -d "${FEATURE_DIR}/contracts" ]] && AVAILABLE_DOCS+=("contracts/")
[[ -f "${FEATURE_DIR}/quickstart.md" ]] && AVAILABLE_DOCS+=("quickstart.md")

# Check if beads is initialized
BEADS_INITIALIZED=false
BEADS_DIR="${REPO_ROOT}/.beads"
[[ -d "$BEADS_DIR" ]] && BEADS_INITIALIZED=true

# Require tasks if specified
if [[ "$REQUIRE_TASKS" == "true" && ! -f "$TASKS" ]]; then
    echo "ERROR: tasks.md not found. Run /speckit.tasks first." >&2
    exit 1
fi

# Read tasks content if requested
TASKS_CONTENT=""
if [[ "$INCLUDE_TASKS" == "true" && -f "$TASKS" ]]; then
    TASKS_CONTENT=$(cat "$TASKS")
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
    # Build available docs array
    DOCS_JSON=$(printf '%s\n' "${AVAILABLE_DOCS[@]}" | jq -R . | jq -s .)

    if [[ "$PATHS_ONLY" == "true" ]]; then
        cat <<EOF
{
  "FEATURE_DIR": "$FEATURE_DIR",
  "FEATURE_SPEC": "$FEATURE_SPEC",
  "IMPL_PLAN": "$IMPL_PLAN",
  "TASKS": "$TASKS",
  "BEADS_INITIALIZED": $BEADS_INITIALIZED
}
EOF
    else
        # Add cached docs hint if --include-refs is set
        REFS_HINT=""
        if [[ "$INCLUDE_REFS" == "true" ]]; then
            REFS_HINT=',
  "DOC_CACHE_HINT": "Query doc_references table for cached documentation. Use get_docs_by_tech() and search_docs_semantic() functions."'
        fi

        cat <<EOF
{
  "REPO_ROOT": "$REPO_ROOT",
  "FEATURE_DIR": "$FEATURE_DIR",
  "FEATURE_SPEC": "$FEATURE_SPEC",
  "IMPL_PLAN": "$IMPL_PLAN",
  "TASKS": "$TASKS",
  "AVAILABLE_DOCS": $DOCS_JSON,
  "BEADS_INITIALIZED": $BEADS_INITIALIZED,
  "BEADS_DIR": "$BEADS_DIR"
}
EOF
    fi
else
    echo "REPO_ROOT=$REPO_ROOT"
    echo "FEATURE_DIR=$FEATURE_DIR"
    echo "FEATURE_SPEC=$FEATURE_SPEC"
    echo "IMPL_PLAN=$IMPL_PLAN"
    echo "TASKS=$TASKS"
    echo "AVAILABLE_DOCS=${AVAILABLE_DOCS[*]}"
    echo "BEADS_INITIALIZED=$BEADS_INITIALIZED"
fi
