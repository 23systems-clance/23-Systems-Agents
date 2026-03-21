#!/bin/bash
# Setup plan for a feature - copies plan template and returns paths

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

# Defaults
JSON_OUTPUT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json|-Json)
            JSON_OUTPUT=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

REPO_ROOT=$(get_repo_root)
BRANCH=$(get_current_branch)
FEATURE_DIR=$(get_feature_dir)
FEATURE_SPEC="${FEATURE_DIR}/spec.md"
IMPL_PLAN="${FEATURE_DIR}/plan.md"

# Check if spec exists
if [[ ! -f "$FEATURE_SPEC" ]]; then
    echo "ERROR: spec.md not found at $FEATURE_SPEC. Run /speckit.specify first." >&2
    exit 1
fi

# Copy plan template if plan doesn't exist
PLAN_TEMPLATE="${REPO_ROOT}/.specify/templates/plan-template.md"
if [[ ! -f "$IMPL_PLAN" ]]; then
    if [[ -f "$PLAN_TEMPLATE" ]]; then
        cp "$PLAN_TEMPLATE" "$IMPL_PLAN"
    else
        # Create minimal plan
        cat > "$IMPL_PLAN" <<EOF
# Implementation Plan

**Branch**: \`$BRANCH\`
**Date**: $(date +%Y-%m-%d)
**Spec**: [spec.md](./spec.md)

## Summary

[To be filled from spec]

## Technical Context

[To be filled]

## Constitution Check

[To be verified against constitution]
EOF
    fi
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
    cat <<EOF
{
  "REPO_ROOT": "$REPO_ROOT",
  "BRANCH": "$BRANCH",
  "SPECS_DIR": "$FEATURE_DIR",
  "FEATURE_SPEC": "$FEATURE_SPEC",
  "IMPL_PLAN": "$IMPL_PLAN"
}
EOF
else
    echo "REPO_ROOT=$REPO_ROOT"
    echo "BRANCH=$BRANCH"
    echo "SPECS_DIR=$FEATURE_DIR"
    echo "FEATURE_SPEC=$FEATURE_SPEC"
    echo "IMPL_PLAN=$IMPL_PLAN"
fi
