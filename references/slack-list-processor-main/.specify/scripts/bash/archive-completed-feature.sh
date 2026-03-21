#!/bin/bash
# Archive a completed SpecKit feature to specs/.completed/

set -e

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get repository root
REPO_ROOT=$(get_repo_root)
COMPLETED_DIR="${REPO_ROOT}/specs/.completed"

# Function to show usage
usage() {
    echo "Usage: $0 [feature-number] [--force]"
    echo ""
    echo "Archive a completed SpecKit feature to specs/.completed/"
    echo ""
    echo "Options:"
    echo "  feature-number    The feature number (e.g., 42 for specs/42-feature-name)"
    echo "                    If omitted, uses current branch feature number"
    echo "  --force          Skip verification checks and force archive"
    echo ""
    echo "Examples:"
    echo "  $0              # Archive feature from current branch"
    echo "  $0 42           # Archive feature 42"
    echo "  $0 42 --force   # Force archive feature 42"
    exit 1
}

# Parse arguments
FEATURE_NUM=""
FORCE=false

for arg in "$@"; do
    case $arg in
        --force)
            FORCE=true
            ;;
        --help|-h)
            usage
            ;;
        *)
            if [[ -z "$FEATURE_NUM" ]]; then
                FEATURE_NUM="$arg"
            fi
            ;;
    esac
done

# If no feature number provided, extract from current branch
if [[ -z "$FEATURE_NUM" ]]; then
    CURRENT_BRANCH=$(get_current_branch)
    FEATURE_NUM=$(get_feature_number "$CURRENT_BRANCH")

    if [[ -z "$FEATURE_NUM" ]]; then
        echo -e "${RED}Error: Could not determine feature number from current branch: $CURRENT_BRANCH${NC}"
        echo "Please provide feature number as argument."
        usage
    fi
fi

# Find the feature directory
FEATURE_DIR=$(find "${REPO_ROOT}/specs" -maxdepth 1 -type d -name "${FEATURE_NUM}-*" ! -path "*/.completed/*" | head -1)

if [[ -z "$FEATURE_DIR" ]]; then
    echo -e "${RED}Error: Feature directory not found for feature number: $FEATURE_NUM${NC}"
    echo "Looking in: ${REPO_ROOT}/specs/${FEATURE_NUM}-*"
    exit 1
fi

FEATURE_NAME=$(basename "$FEATURE_DIR")
TASKS_FILE="${FEATURE_DIR}/tasks.md"

echo -e "${GREEN}Found feature: ${FEATURE_NAME}${NC}"
echo "Location: ${FEATURE_DIR}"

# Verification checks (unless --force is used)
if [[ "$FORCE" != "true" ]]; then
    echo ""
    echo -e "${YELLOW}Running verification checks...${NC}"

    # Check if tasks.md exists
    if [[ ! -f "$TASKS_FILE" ]]; then
        echo -e "${RED}Warning: tasks.md not found in feature directory${NC}"
        read -p "Continue anyway? (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            echo "Aborted."
            exit 1
        fi
    else
        # Check for incomplete tasks
        INCOMPLETE_TASKS=$(grep -E '^\s*-\s*\[ \]' "$TASKS_FILE" 2>/dev/null | wc -l)
        COMPLETED_TASKS=$(grep -E '^\s*-\s*\[x\]' "$TASKS_FILE" 2>/dev/null | wc -l)

        if [[ "$INCOMPLETE_TASKS" -gt 0 ]]; then
            echo -e "${RED}Warning: Found $INCOMPLETE_TASKS incomplete tasks in tasks.md${NC}"
            echo "Completed: $COMPLETED_TASKS, Incomplete: $INCOMPLETE_TASKS"
            read -p "Archive anyway? (y/N): " confirm
            if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
                echo "Aborted. Complete tasks first or use --force to override."
                exit 1
            fi
        else
            echo -e "${GREEN}✓ All tasks completed ($COMPLETED_TASKS tasks)${NC}"
        fi
    fi

    # Final confirmation
    echo ""
    read -p "Archive ${FEATURE_NAME} to specs/.completed/? (y/N): " final_confirm
    if [[ "$final_confirm" != "y" && "$final_confirm" != "Y" ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# Create .completed directory if it doesn't exist
mkdir -p "$COMPLETED_DIR"

# Archive the feature
DEST_DIR="${COMPLETED_DIR}/${FEATURE_NAME}"

if [[ -d "$DEST_DIR" ]]; then
    echo -e "${YELLOW}Warning: ${FEATURE_NAME} already exists in .completed${NC}"
    read -p "Overwrite? (y/N): " overwrite
    if [[ "$overwrite" == "y" || "$overwrite" == "Y" ]]; then
        rm -rf "$DEST_DIR"
    else
        echo "Aborted."
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}Moving feature to archive...${NC}"
mv "$FEATURE_DIR" "$DEST_DIR"

echo -e "${GREEN}✓ Feature archived successfully!${NC}"
echo "Location: ${DEST_DIR}"

# Check for related beads issues
echo ""
echo -e "${YELLOW}Checking for related beads issues...${NC}"
if command -v bd &> /dev/null; then
    # Search for issues related to this feature
    BEADS_ISSUES=$(bd list --json 2>/dev/null | jq -r ".[] | select(.title | contains(\"${FEATURE_NUM}\") or contains(\"${FEATURE_NAME}\")) | .id" || echo "")

    if [[ -n "$BEADS_ISSUES" ]]; then
        echo "Found related beads issues:"
        echo "$BEADS_ISSUES"
        echo ""
        echo "Close them with:"
        for issue_id in $BEADS_ISSUES; do
            echo "  bd close $issue_id --reason 'Feature completed and archived'"
        done
    else
        echo "No related beads issues found."
    fi
else
    echo "Beads CLI not installed. Skipping beads check."
fi

echo ""
echo -e "${GREEN}Archive complete!${NC}"
