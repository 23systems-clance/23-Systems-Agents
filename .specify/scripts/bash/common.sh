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

# Get the current feature name from .specify/.current-feature
get_current_feature() {
    local repo_root=$(get_repo_root)
    local current_feature_file="${repo_root}/.specify/.current-feature"
    if [[ -f "$current_feature_file" ]]; then
        cat "$current_feature_file" | tr -d '[:space:]'
    else
        echo ""
    fi
}

# Find the spec file for the current feature.
# Specs live in directories: specs/NNN-name/spec.md
# Resolution order:
#   1. .specify/.current-feature → match directory in specs/
#   2. Branch name → match directory in specs/
get_feature_spec() {
    local repo_root=$(get_repo_root)
    local specs_dir="${repo_root}/specs"
    local feature_name=$(get_current_feature)

    # Try current-feature match
    if [[ -d "$specs_dir" && -n "$feature_name" ]]; then
        local match=""
        if [[ "$feature_name" =~ ^[0-9]+-. ]]; then
            match=$(find "$specs_dir" -maxdepth 1 -type d -name "${feature_name}*" 2>/dev/null | head -1)
        else
            match=$(find "$specs_dir" -maxdepth 1 -type d -name "*${feature_name}*" 2>/dev/null | sort | head -1)
        fi
        if [[ -n "$match" && -f "${match}/spec.md" ]]; then
            echo "${match}/spec.md"
            return
        fi
    fi

    # Try branch-based match
    if [[ -d "$specs_dir" ]]; then
        local branch=$(get_current_branch)
        local feature_num=$(get_feature_number "$branch")
        if [[ -n "$feature_num" ]]; then
            local match=$(find "$specs_dir" -maxdepth 1 -type d -name "${feature_num}-*" 2>/dev/null | head -1)
            if [[ -n "$match" && -f "${match}/spec.md" ]]; then
                echo "${match}/spec.md"
                return
            fi
        fi
    fi

    echo ""
}

# Find the spec file for a given spec number.
get_spec_by_number() {
    local spec_number="$1"
    local repo_root=$(get_repo_root)
    local specs_dir="${repo_root}/specs"

    if [[ -d "$specs_dir" ]]; then
        local match=$(find "$specs_dir" -maxdepth 1 -type d -name "${spec_number}-*" 2>/dev/null | head -1)
        if [[ -n "$match" && -f "${match}/spec.md" ]]; then
            echo "${match}/spec.md"
            return
        fi
    fi

    echo ""
}

# List all available specs
list_all_specs() {
    local repo_root=$(get_repo_root)
    local specs_dir="${repo_root}/specs"

    if [[ -d "$specs_dir" ]]; then
        find "$specs_dir" -maxdepth 2 -name "spec.md" -type f 2>/dev/null | sort
    fi
}

# Find specs directory for current feature (legacy compat — prefers get_feature_spec)
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
