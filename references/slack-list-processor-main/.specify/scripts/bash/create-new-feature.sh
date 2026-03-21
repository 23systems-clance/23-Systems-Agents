#!/bin/bash
# Create a new feature branch and spec directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

# Defaults
JSON_OUTPUT=false
FEATURE_NUMBER=""
SHORT_NAME=""
DESCRIPTION=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json|-Json)
            JSON_OUTPUT=true
            shift
            ;;
        --number|-Number)
            FEATURE_NUMBER="$2"
            shift 2
            ;;
        --short-name|-ShortName)
            SHORT_NAME="$2"
            shift 2
            ;;
        *)
            if [[ -z "$DESCRIPTION" ]]; then
                DESCRIPTION="$1"
            else
                DESCRIPTION="$DESCRIPTION $1"
            fi
            shift
            ;;
    esac
done

if [[ -z "$SHORT_NAME" ]]; then
    echo "ERROR: --short-name is required" >&2
    exit 1
fi

if [[ -z "$FEATURE_NUMBER" ]]; then
    FEATURE_NUMBER=1
fi

REPO_ROOT=$(get_repo_root)
BRANCH_NAME="${FEATURE_NUMBER}-${SHORT_NAME}"
SPECS_DIR="${REPO_ROOT}/specs/${BRANCH_NAME}"
SPEC_FILE="${SPECS_DIR}/spec.md"

# Create specs directory
mkdir -p "$SPECS_DIR"
mkdir -p "${SPECS_DIR}/checklists"
mkdir -p "${SPECS_DIR}/contracts"

# Create initial spec file from template
TEMPLATE="${REPO_ROOT}/.specify/templates/spec-template.md"
if [[ -f "$TEMPLATE" ]]; then
    cp "$TEMPLATE" "$SPEC_FILE"
else
    # Create minimal spec if template doesn't exist
    cat > "$SPEC_FILE" <<EOF
# Feature Specification: ${SHORT_NAME}

**Feature Branch**: \`${BRANCH_NAME}\`
**Created**: $(date +%Y-%m-%d)
**Status**: Draft
**Input**: User description: "${DESCRIPTION}"

## User Scenarios & Testing

[To be filled]

## Requirements

[To be filled]

## Success Criteria

[To be filled]
EOF
fi

# Create and checkout branch (if in git repo)
if is_git_repo; then
    # Check if branch exists
    if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
        git checkout "$BRANCH_NAME"
    else
        git checkout -b "$BRANCH_NAME"
    fi
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
    cat <<EOF
{
  "BRANCH_NAME": "$BRANCH_NAME",
  "SPECS_DIR": "$SPECS_DIR",
  "SPEC_FILE": "$SPEC_FILE",
  "FEATURE_NUMBER": "$FEATURE_NUMBER",
  "SHORT_NAME": "$SHORT_NAME",
  "DESCRIPTION": "$DESCRIPTION"
}
EOF
else
    echo "Created feature: $BRANCH_NAME"
    echo "Specs directory: $SPECS_DIR"
    echo "Spec file: $SPEC_FILE"
fi
