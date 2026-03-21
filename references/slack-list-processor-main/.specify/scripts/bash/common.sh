#!/bin/bash
# Common utilities for SpecKit scripts

# Get repository root
get_repo_root() {
    git rev-parse --show-toplevel 2>/dev/null || pwd
}

# Get current branch name
get_current_branch() {
    git branch --show-current 2>/dev/null || echo "main"
}

# Check if we're in a git repository
is_git_repo() {
    git rev-parse --git-dir >/dev/null 2>&1
}

# Extract feature number from branch name (e.g., "123-feature-name" -> "123")
get_feature_number() {
    local branch="$1"
    echo "$branch" | grep -oE '^[0-9]+' || echo ""
}

# Extract feature short name from branch name (e.g., "123-feature-name" -> "feature-name")
get_feature_short_name() {
    local branch="$1"
    echo "$branch" | sed -E 's/^[0-9]+-//'
}

# Find specs directory for current feature
get_feature_dir() {
    local repo_root=$(get_repo_root)
    local branch=$(get_current_branch)
    local feature_num=$(get_feature_number "$branch")
    local short_name=$(get_feature_short_name "$branch")

    if [[ -n "$feature_num" ]]; then
        echo "${repo_root}/specs/${feature_num}-${short_name}"
    else
        echo "${repo_root}/specs/${branch}"
    fi
}

# Output JSON helper
json_output() {
    local key="$1"
    local value="$2"
    echo "\"$key\": \"$value\""
}
