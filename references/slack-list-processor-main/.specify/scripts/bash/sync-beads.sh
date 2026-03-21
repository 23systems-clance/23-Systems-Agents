#!/bin/bash
# Sync tasks.md with beads issue tracker
# Usage: sync-beads.sh <tasks-file> [--create-epic "Epic Name"]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

TASKS_FILE=""
EPIC_NAME=""
CREATE_EPIC=false
DRY_RUN=false
JSON_OUTPUT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --create-epic)
            CREATE_EPIC=true
            EPIC_NAME="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        *)
            if [[ -z "$TASKS_FILE" ]]; then
                TASKS_FILE="$1"
            fi
            shift
            ;;
    esac
done

if [[ -z "$TASKS_FILE" ]]; then
    echo "ERROR: No tasks file specified" >&2
    echo "Usage: sync-beads.sh <tasks-file> [--create-epic \"Epic Name\"] [--dry-run] [--json]" >&2
    exit 1
fi

if [[ ! -f "$TASKS_FILE" ]]; then
    echo "ERROR: Tasks file not found: $TASKS_FILE" >&2
    exit 1
fi

REPO_ROOT=$(get_repo_root)
BEADS_DIR="${REPO_ROOT}/.beads"
MAPPING_FILE="${BEADS_DIR}/task-mapping.json"

# Check if beads is initialized
if [[ ! -d "$BEADS_DIR" ]]; then
    echo "ERROR: Beads not initialized. Run 'bd init' first." >&2
    exit 1
fi

# Check if bd command is available (try common locations)
BD_CMD=""
if command -v bd &> /dev/null; then
    BD_CMD="bd"
elif [[ -x "$HOME/.npm-global/bin/bd" ]]; then
    BD_CMD="$HOME/.npm-global/bin/bd"
elif [[ -x "/usr/local/bin/bd" ]]; then
    BD_CMD="/usr/local/bin/bd"
elif [[ -x "$HOME/go/bin/bd" ]]; then
    BD_CMD="$HOME/go/bin/bd"
else
    echo "ERROR: 'bd' command not found. Install beads first." >&2
    exit 1
fi

# Create bd wrapper function
bd() {
    "$BD_CMD" "$@"
}

# Initialize mapping file if it doesn't exist
if [[ ! -f "$MAPPING_FILE" ]]; then
    echo "{}" > "$MAPPING_FILE"
fi

# Load existing mapping
MAPPING=$(cat "$MAPPING_FILE")

# Create epic if requested
EPIC_ID=""
if [[ "$CREATE_EPIC" == "true" && -n "$EPIC_NAME" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "DRY-RUN: Would create epic: $EPIC_NAME"
        EPIC_ID="dry-run-epic"
    else
        EPIC_RESULT=$(bd create "$EPIC_NAME" -t epic -p 1 --json 2>/dev/null || echo '{"error": true}')
        if echo "$EPIC_RESULT" | jq -e '.id' > /dev/null 2>&1; then
            EPIC_ID=$(echo "$EPIC_RESULT" | jq -r '.id')
            echo "Created epic: $EPIC_ID - $EPIC_NAME"
        else
            echo "WARNING: Failed to create epic" >&2
        fi
    fi
fi

# Parse tasks from tasks.md
# Format: - [ ] T001 [P] [US1] Description
# Or:     - [x] T001 [P] [US1] Description (completed)

CREATED=0
UPDATED=0
SKIPPED=0

while IFS= read -r line; do
    # Match task lines: - [ ] T### or - [x] T###
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*\[([xX[:space:]])\][[:space:]]*(T[0-9]+) ]]; then
        STATUS="${BASH_REMATCH[1]}"
        TASK_ID="${BASH_REMATCH[2]}"

        # Extract the rest of the line as description
        DESCRIPTION=$(echo "$line" | sed -E 's/^[[:space:]]*-[[:space:]]*\[[xX[:space:]]\][[:space:]]*T[0-9]+[[:space:]]*//')

        # Extract labels from [P] and [US#] markers
        LABELS=""
        if [[ "$DESCRIPTION" =~ \[P\] ]]; then
            LABELS="parallel"
            DESCRIPTION=$(echo "$DESCRIPTION" | sed 's/\[P\][[:space:]]*//')
        fi
        if [[ "$DESCRIPTION" =~ \[US([0-9]+)\] ]]; then
            US_NUM="${BASH_REMATCH[1]}"
            if [[ -n "$LABELS" ]]; then
                LABELS="${LABELS},US${US_NUM}"
            else
                LABELS="US${US_NUM}"
            fi
            DESCRIPTION=$(echo "$DESCRIPTION" | sed -E 's/\[US[0-9]+\][[:space:]]*//')
        fi

        # Trim description
        DESCRIPTION=$(echo "$DESCRIPTION" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

        # Check if task already exists in mapping
        EXISTING_ID=$(echo "$MAPPING" | jq -r --arg tid "$TASK_ID" '.[$tid] // empty')

        if [[ -n "$EXISTING_ID" ]]; then
            # Task exists - check if status changed
            if [[ "$STATUS" =~ [xX] ]]; then
                # Task is completed in tasks.md
                if [[ "$DRY_RUN" == "true" ]]; then
                    echo "DRY-RUN: Would close $EXISTING_ID ($TASK_ID)"
                else
                    bd close "$EXISTING_ID" --reason "Completed in tasks.md" --json > /dev/null 2>&1 || true
                    echo "Closed: $EXISTING_ID ($TASK_ID)"
                fi
                ((UPDATED++))
            else
                ((SKIPPED++))
            fi
        else
            # Create new beads issue
            if [[ "$DRY_RUN" == "true" ]]; then
                echo "DRY-RUN: Would create issue for $TASK_ID: $DESCRIPTION"
                ((CREATED++))
            else
                CREATE_CMD="bd create \"${TASK_ID}: ${DESCRIPTION}\" -t task -p 2"
                if [[ -n "$LABELS" ]]; then
                    CREATE_CMD="${CREATE_CMD} -l \"${LABELS}\""
                fi
                CREATE_CMD="${CREATE_CMD} --json"

                RESULT=$(eval "$CREATE_CMD" 2>/dev/null || echo '{"error": true}')

                if echo "$RESULT" | jq -e '.id' > /dev/null 2>&1; then
                    NEW_ID=$(echo "$RESULT" | jq -r '.id')
                    # Add to mapping
                    MAPPING=$(echo "$MAPPING" | jq --arg tid "$TASK_ID" --arg bid "$NEW_ID" '. + {($tid): $bid}')
                    echo "Created: $NEW_ID ($TASK_ID)"
                    ((CREATED++))
                else
                    echo "WARNING: Failed to create issue for $TASK_ID" >&2
                fi
            fi
        fi
    fi
done < "$TASKS_FILE"

# Save updated mapping
if [[ "$DRY_RUN" != "true" ]]; then
    echo "$MAPPING" | jq '.' > "$MAPPING_FILE"

    # Sync beads to git
    bd sync > /dev/null 2>&1 || true
fi

# Output results
if [[ "$JSON_OUTPUT" == "true" ]]; then
    cat <<EOF
{
  "created": $CREATED,
  "updated": $UPDATED,
  "skipped": $SKIPPED,
  "epic_id": "${EPIC_ID:-null}",
  "mapping_file": "$MAPPING_FILE"
}
EOF
else
    echo "---"
    echo "Sync complete:"
    echo "  Created: $CREATED"
    echo "  Updated: $UPDATED"
    echo "  Skipped: $SKIPPED"
    if [[ -n "$EPIC_ID" ]]; then
        echo "  Epic: $EPIC_ID"
    fi
fi
