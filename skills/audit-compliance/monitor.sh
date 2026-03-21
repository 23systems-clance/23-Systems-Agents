#!/usr/bin/env bash
set -uo pipefail

FRAMEWORK="${1:?Usage: monitor.sh <soc2|hipaa|all> [target-path]}"
TARGET="${2:-.}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
VIOLATIONS=0
DRIFTS=0
PASSES=0

FRAMEWORK=$(echo "$FRAMEWORK" | tr '[:upper:]' '[:lower:]')
GREP_EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.nuxt --exclude-dir=dist --exclude-dir=build --exclude-dir=vendor --exclude-dir=__pycache__ --exclude-dir=.venv --exclude-dir=venv)

if [[ "$FRAMEWORK" != "soc2" && "$FRAMEWORK" != "hipaa" && "$FRAMEWORK" != "all" ]]; then
  echo "Error: Framework must be 'soc2', 'hipaa', or 'all'"
  exit 1
fi

echo "=== Compliance Monitor ==="
echo "Framework: $FRAMEWORK"
echo "Target: $(cd "$TARGET" && pwd)"
echo "Time: $TIMESTAMP"
echo ""

check() {
  local name="$1"
  local status="$2"  # PASS, DRIFT, VIOLATION
  local detail="$3"

  case "$status" in
    PASS) PASSES=$((PASSES + 1)); echo "[PASS] $name" ;;
    DRIFT) DRIFTS=$((DRIFTS + 1)); echo "[DRIFT] $name — $detail" ;;
    VIOLATION) VIOLATIONS=$((VIOLATIONS + 1)); echo "[VIOLATION] $name — $detail" ;;
  esac
}

# --- Universal Checks ---

echo "--- Security Controls ---"

# Check for plaintext secrets in tracked files
if git -C "$TARGET" ls-files 2>/dev/null | xargs grep -l "password.*=\|secret.*=\|api_key.*=\|apikey.*=" 2>/dev/null | grep -v ".env.example" | grep -v "node_modules" | grep -v "SKILL.md\|CLAUDE.md\|\.md$" | head -1 > /dev/null 2>&1; then
  check "No secrets in version control" "VIOLATION" "Potential plaintext secrets found in tracked files"
else
  check "No secrets in version control" "PASS" ""
fi

# Check .env is gitignored
if [ -f "$TARGET/.gitignore" ]; then
  if grep -q "\.env" "$TARGET/.gitignore" 2>/dev/null; then
    check ".env gitignored" "PASS" ""
  else
    check ".env gitignored" "VIOLATION" ".env is not in .gitignore"
  fi
else
  check ".env gitignored" "DRIFT" "No .gitignore file found"
fi

# Check for HTTP URLs in source
HTTP_COUNT=$(grep -rl "http://" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" --include="*.go" 2>/dev/null | head -20 | xargs grep -h "http://" 2>/dev/null | grep -cv "localhost\|127.0.0.1\|http://schemas\|http://www.w3.org" || true)
HTTP_COUNT=$((HTTP_COUNT + 0))
if [ "$HTTP_COUNT" -gt 0 ]; then
  check "No plain HTTP in source" "DRIFT" "$HTTP_COUNT non-localhost HTTP URLs found"
else
  check "No plain HTTP in source" "PASS" ""
fi

# Check for dependency vulnerabilities
if [ -f "$TARGET/package.json" ]; then
  if command -v npm &> /dev/null; then
    VULN_COUNT=$(cd "$TARGET" && npm audit --json 2>/dev/null | grep -o '"total":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
    VULN_COUNT=${VULN_COUNT:-0}
    if [ "$VULN_COUNT" -gt 0 ] 2>/dev/null; then
      check "No known vulnerabilities" "DRIFT" "$VULN_COUNT npm vulnerabilities found — run npm audit fix"
    else
      check "No known vulnerabilities" "PASS" ""
    fi
  fi
fi

echo ""
echo "--- Policy Currency ---"

# Check if compliance policies exist and aren't stale
if [ -d "$TARGET/compliance-output" ]; then
  STALE_POLICIES=0
  YEAR_AGO=$(date -u -v-1y +%s 2>/dev/null || date -u -d '-1 year' +%s 2>/dev/null || echo "0")

  while IFS= read -r policy; do
    MOD_TIME=$(stat -f %m "$policy" 2>/dev/null || stat -c %Y "$policy" 2>/dev/null || echo "0")
    if [ "$MOD_TIME" -lt "$YEAR_AGO" ] 2>/dev/null; then
      STALE_POLICIES=$((STALE_POLICIES + 1))
    fi
  done < <(find "$TARGET/compliance-output" -name "*.md" -type f 2>/dev/null)

  if [ "$STALE_POLICIES" -gt 0 ]; then
    check "Policies current (<12 months)" "DRIFT" "$STALE_POLICIES policies older than 12 months — review and update"
  else
    check "Policies current (<12 months)" "PASS" ""
  fi
else
  check "Compliance policies exist" "VIOLATION" "No compliance-output directory — run implement.sh first"
fi

# --- HIPAA-Specific Monitoring ---

if [[ "$FRAMEWORK" == "hipaa" || "$FRAMEWORK" == "all" ]]; then
  echo ""
  echo "--- HIPAA-Specific ---"

  # Check for PHI in logs
  PHI_IN_LOGS=$(grep -r "ssn\|social.security\|date.of.birth\|diagnosis\|medical.record\|insurance.id\|patient.name" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.log" --include="*.jsonl" -i -l 2>/dev/null | head -5 | wc -l | tr -d ' ')
  if [ "$PHI_IN_LOGS" -gt 0 ]; then
    check "No PHI in log files" "VIOLATION" "Potential PHI found in $PHI_IN_LOGS log files"
  else
    check "No PHI in log files" "PASS" ""
  fi

  # Check for PHI in code comments/strings
  PHI_PATTERNS=$(grep -r "SSN.*[0-9]\{3\}-[0-9]\{2\}-[0-9]\{4\}\|DOB.*[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" -l 2>/dev/null | wc -l | tr -d ' ')
  if [ "$PHI_PATTERNS" -gt 0 ]; then
    check "No hardcoded PHI in source" "VIOLATION" "Potential hardcoded PHI patterns in $PHI_PATTERNS files"
  else
    check "No hardcoded PHI in source" "PASS" ""
  fi

  # Check SRA exists
  if find "$TARGET" -maxdepth 4 -iname "*risk*assessment*" -o -iname "*sra*" 2>/dev/null | head -1 | grep -q .; then
    check "Security Risk Assessment exists" "PASS" ""
  else
    check "Security Risk Assessment exists" "VIOLATION" "No SRA found — required by 164.308(a)(1)"
  fi
fi

# --- SOC2-Specific Monitoring ---

if [[ "$FRAMEWORK" == "soc2" || "$FRAMEWORK" == "all" ]]; then
  echo ""
  echo "--- SOC2-Specific ---"

  # Check CI/CD exists
  if [ -d "$TARGET/.github/workflows" ] || [ -f "$TARGET/.gitlab-ci.yml" ]; then
    check "CI/CD pipeline active" "PASS" ""
  else
    check "CI/CD pipeline active" "DRIFT" "No CI/CD configuration detected"
  fi

  # Check for branch protection (via CODEOWNERS or branch rules)
  if [ -f "$TARGET/.github/CODEOWNERS" ] || [ -f "$TARGET/CODEOWNERS" ]; then
    check "Code review enforcement" "PASS" "CODEOWNERS file found"
  else
    check "Code review enforcement" "DRIFT" "No CODEOWNERS file — verify branch protection rules are configured"
  fi
fi

# --- Summary ---

TOTAL=$((PASSES + DRIFTS + VIOLATIONS))

echo ""
echo "=== Monitor Summary ==="
echo "PASS: $PASSES | DRIFT: $DRIFTS | VIOLATION: $VIOLATIONS | Total: $TOTAL"
echo ""

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "STATUS: VIOLATIONS FOUND — immediate action required"
  exit 2
elif [ "$DRIFTS" -gt 0 ]; then
  echo "STATUS: DRIFT DETECTED — review and remediate"
  exit 1
else
  echo "STATUS: COMPLIANT — all monitored controls passing"
  exit 0
fi
