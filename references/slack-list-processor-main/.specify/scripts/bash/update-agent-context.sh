#!/bin/bash
# Update agent-specific context files (e.g., CLAUDE.md)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

AGENT="${1:-claude}"
REPO_ROOT=$(get_repo_root)

case "$AGENT" in
    claude)
        CONTEXT_FILE="${REPO_ROOT}/CLAUDE.md"
        ;;
    cursor)
        CONTEXT_FILE="${REPO_ROOT}/.cursorrules"
        ;;
    *)
        echo "Unknown agent: $AGENT"
        exit 1
        ;;
esac

echo "Agent context file: $CONTEXT_FILE"
echo "Update this file with project-specific context as needed."
