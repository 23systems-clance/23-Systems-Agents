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
# 23 Systems Agents uses flat files in .specify/specs/ (e.g., 000-rebrand.md)
# rather than directories in specs/ (e.g., specs/000-rebrand/spec.md).
# Resolution order:
#   1. .specify/.current-feature → match in .specify/specs/
#   2. Branch name → match in .specify/specs/
#   3. Fallback to specs/ directory structure (reference project compat)
get_feature_spec() {
    local repo_root=$(get_repo_root)
    local specify_specs_dir="${repo_root}/.specify/specs"
    local feature_name=$(get_current_feature)

    # Try .specify/specs/ flat file first (this project's convention)
    if [[ -d "$specify_specs_dir" && -n "$feature_name" ]]; then
        # If feature_name looks like "N-name" (has number prefix), match exactly
        # Otherwise match by name, preferring lowest-numbered spec (the primary one)
        local match=""
        if [[ "$feature_name" =~ ^[0-9]+-. ]]; then
            match=$(find "$specify_specs_dir" -maxdepth 1 -name "${feature_name}*" -type f 2>/dev/null | head -1)
        else
            match=$(find "$specify_specs_dir" -maxdepth 1 -name "*${feature_name}*" -type f 2>/dev/null | sort | head -1)
        fi
        if [[ -n "$match" ]]; then
            echo "$match"
            return
        fi
    fi

    # Try branch-based match in .specify/specs/
    if [[ -d "$specify_specs_dir" ]]; then
        local branch=$(get_current_branch)
        local feature_num=$(get_feature_number "$branch")
        if [[ -n "$feature_num" ]]; then
            local match=$(find "$specify_specs_dir" -maxdepth 1 -name "${feature_num}-*" -type f 2>/dev/null | head -1)
            if [[ -n "$match" ]]; then
                echo "$match"
                return
            fi
        fi
    fi

    # Fallback: specs/ directory structure (reference project compat)
    local branch=$(get_current_branch)
    local feature_num=$(get_feature_number "$branch")
    local short_name=$(get_feature_short_name "$branch")
    if [[ -n "$feature_num" ]]; then
        local dir="${repo_root}/specs/${feature_num}-${short_name}"
        if [[ -f "${dir}/spec.md" ]]; then
            echo "${dir}/spec.md"
            return
        fi
    fi

    echo ""
}

# Find the spec file for a given spec number.
# Checks .specify/specs/ flat files first, then specs/ directories.
get_spec_by_number() {
    local spec_number="$1"
    local repo_root=$(get_repo_root)
    local specify_specs_dir="${repo_root}/.specify/specs"

    # Try .specify/specs/ flat file
    if [[ -d "$specify_specs_dir" ]]; then
        local match=$(find "$specify_specs_dir" -maxdepth 1 -name "${spec_number}-*" -type f 2>/dev/null | head -1)
        if [[ -n "$match" ]]; then
            echo "$match"
            return
        fi
    fi

    # Fallback: specs/ directory
    local spec_dir=$(find "${repo_root}/specs" -maxdepth 1 -type d -name "${spec_number}-*" 2>/dev/null | head -1)
    if [[ -n "$spec_dir" && -f "${spec_dir}/spec.md" ]]; then
        echo "${spec_dir}/spec.md"
        return
    fi

    echo ""
}

# List all available specs across both locations
list_all_specs() {
    local repo_root=$(get_repo_root)
    local specify_specs_dir="${repo_root}/.specify/specs"

    # Flat files in .specify/specs/
    if [[ -d "$specify_specs_dir" ]]; then
        find "$specify_specs_dir" -maxdepth 1 -name "[0-9]*-*.md" -type f 2>/dev/null | sort
    fi

    # Directories in specs/
    if [[ -d "${repo_root}/specs" ]]; then
        for dir in "${repo_root}/specs"/[0-9]*-*/; do
            if [[ -f "${dir}spec.md" ]]; then
                echo "${dir}spec.md"
            fi
        done
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
