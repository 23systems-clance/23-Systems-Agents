#!/usr/bin/env bash
set -uo pipefail

FRAMEWORK="${1:?Usage: audit.sh <soc2|hipaa|all> [target-path]}"
TARGET="${2:-.}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORKS_DIR="$SCRIPT_DIR/frameworks"
OUTPUT_DIR="$TARGET/compliance-output"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SCORE_TOTAL=0
SCORE_PASS=0
RESULTS=""

# Common directories to exclude from scanning
GREP_EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.nuxt --exclude-dir=dist --exclude-dir=build --exclude-dir=vendor --exclude-dir=__pycache__ --exclude-dir=.venv --exclude-dir=venv)

# Normalize framework
FRAMEWORK=$(echo "$FRAMEWORK" | tr '[:upper:]' '[:lower:]')

if [[ "$FRAMEWORK" != "soc2" && "$FRAMEWORK" != "hipaa" && "$FRAMEWORK" != "all" ]]; then
  echo "Error: Framework must be 'soc2', 'hipaa', or 'all'"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "=== Compliance Audit ==="
echo "Framework: $FRAMEWORK"
echo "Target: $(cd "$TARGET" && pwd)"
echo "Time: $TIMESTAMP"
echo ""

# --- Common Control Checks ---

check_control() {
  local id="$1"
  local name="$2"
  local status="$3"  # PASS, FAIL, WARN, MANUAL
  local detail="$4"

  SCORE_TOTAL=$((SCORE_TOTAL + 1))
  if [[ "$status" == "PASS" ]]; then
    SCORE_PASS=$((SCORE_PASS + 1))
  fi

  local icon="?"
  case "$status" in
    PASS) icon="[PASS]" ;;
    FAIL) icon="[FAIL]" ;;
    WARN) icon="[WARN]" ;;
    MANUAL) icon="[MANUAL]" ;;
  esac

  echo "$icon $id: $name"
  if [[ -n "$detail" ]]; then
    echo "      $detail"
  fi

  RESULTS="${RESULTS}\n| $id | $name | $status | $detail |"
}

echo "--- Checking Common Controls ---"
echo ""

# CC-01: Encryption at Rest
if find "$TARGET" -maxdepth 3 \( -name "node_modules" -o -name ".git" -o -name ".next" \) -prune -o \( -name "*.env" -o -name ".env.*" \) -print 2>/dev/null | head -5 | xargs grep -l "PASSWORD\|SECRET\|KEY\|TOKEN" 2>/dev/null | head -1 > /dev/null 2>&1; then
  check_control "CC-01" "Encryption at Rest" "WARN" "Found potential plaintext secrets in .env files — verify they are gitignored"
else
  check_control "CC-01" "Encryption at Rest" "PASS" "No plaintext secrets detected in scanned config files"
fi

# CC-02: Encryption in Transit
if grep -r "http://" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" --include="*.go" --include="*.java" -l 2>/dev/null | head -1 > /dev/null 2>&1; then
  check_control "CC-02" "Encryption in Transit" "WARN" "Found http:// URLs in source code — verify no production endpoints use plain HTTP"
else
  check_control "CC-02" "Encryption in Transit" "PASS" "No plain HTTP URLs found in source code"
fi

# CC-03: Authentication
HAS_AUTH=false
if grep -r "auth\|authentication\|login\|session\|jwt\|oauth" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" -l 2>/dev/null | head -1 > /dev/null 2>&1; then
  HAS_AUTH=true
fi
if [[ "$HAS_AUTH" == "true" ]]; then
  # Check for session timeout
  if grep -r "maxAge\|max_age\|session.*timeout\|SESSION_TIMEOUT\|expires" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" 2>/dev/null | head -1 > /dev/null 2>&1; then
    check_control "CC-03" "Authentication Controls" "PASS" "Authentication with session management detected"
  else
    check_control "CC-03" "Authentication Controls" "WARN" "Authentication found but no session timeout configuration detected"
  fi
else
  check_control "CC-03" "Authentication Controls" "FAIL" "No authentication implementation detected"
fi

# CC-04: Access Control
if grep -r "role\|rbac\|permission\|authorize\|isAdmin\|hasRole\|canAccess" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" -l 2>/dev/null | head -1 > /dev/null 2>&1; then
  check_control "CC-04" "Access Control" "PASS" "Role-based access control patterns detected"
else
  check_control "CC-04" "Access Control" "WARN" "No RBAC patterns detected — verify access control implementation"
fi

# CC-05: Audit Logging
if grep -r "audit.*log\|\.info(\|\.warn(\|logger\.\|logging\.\|console\.log\|winston\|pino\|bunyan" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" -l 2>/dev/null | head -1 > /dev/null 2>&1; then
  check_control "CC-05" "Audit Logging" "WARN" "Logging detected — verify it captures: actor, action, resource, timestamp, outcome"
else
  check_control "CC-05" "Audit Logging" "FAIL" "No audit logging implementation detected"
fi

# CC-06: Incident Response
if find "$TARGET" -maxdepth 3 -iname "*incident*response*" -o -iname "*incident*plan*" 2>/dev/null | head -1 | grep -q .; then
  check_control "CC-06" "Incident Response" "PASS" "Incident response documentation found"
else
  check_control "CC-06" "Incident Response" "FAIL" "No incident response plan found — must be created"
fi

# CC-07: Change Management
if [ -d "$TARGET/.github" ] || [ -d "$TARGET/.gitlab" ] || [ -f "$TARGET/.gitlab-ci.yml" ] || [ -f "$TARGET/Jenkinsfile" ]; then
  check_control "CC-07" "Change Management" "PASS" "CI/CD pipeline detected"
else
  check_control "CC-07" "Change Management" "WARN" "No CI/CD pipeline detected — verify change management process"
fi

# CC-08: Vulnerability Management
if [ -f "$TARGET/package.json" ] || [ -f "$TARGET/requirements.txt" ] || [ -f "$TARGET/go.mod" ]; then
  if grep -r "dependabot\|snyk\|npm.audit\|safety\|govulncheck" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.yml" --include="*.yaml" --include="*.json" 2>/dev/null | head -1 > /dev/null 2>&1; then
    check_control "CC-08" "Vulnerability Management" "PASS" "Dependency scanning configured"
  else
    check_control "CC-08" "Vulnerability Management" "WARN" "Dependencies found but no automated vulnerability scanning configured"
  fi
else
  check_control "CC-08" "Vulnerability Management" "MANUAL" "Unable to determine dependency management — manual review needed"
fi

# CC-09: Backup & Recovery
check_control "CC-09" "Backup & Recovery" "MANUAL" "Verify backup configuration, encryption, and recovery testing"

# CC-10: Data Classification
if find "$TARGET" -maxdepth 3 -iname "*data*class*" -o -iname "*data*policy*" 2>/dev/null | head -1 | grep -q .; then
  check_control "CC-10" "Data Classification" "PASS" "Data classification documentation found"
else
  check_control "CC-10" "Data Classification" "FAIL" "No data classification policy found — must be created"
fi

echo ""

# --- Framework-Specific Checks ---

if [[ "$FRAMEWORK" == "hipaa" || "$FRAMEWORK" == "all" ]]; then
  echo "--- Checking HIPAA-Specific Controls ---"
  echo ""

  # HIPAA-01: Security Risk Assessment
  if find "$TARGET" -maxdepth 3 -iname "*risk*assessment*" -o -iname "*sra*" 2>/dev/null | head -1 | grep -q .; then
    check_control "HIPAA-01" "Security Risk Assessment" "PASS" "SRA document found"
  else
    check_control "HIPAA-01" "Security Risk Assessment" "FAIL" "No Security Risk Assessment found — this is HIPAA's #1 requirement"
  fi

  # HIPAA-02: PHI Data Flow
  # Check for PHI fields in logs
  if grep -r "console\.\(log\|error\|warn\|info\).*\(ssn\|social.*security\|date.*birth\|dob\|diagnosis\|mrn\|medical.*record\|insurance\|patient.*name\)" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" -i 2>/dev/null | head -1 > /dev/null 2>&1; then
    check_control "HIPAA-02" "PHI Data Flow" "FAIL" "Potential PHI found in log statements — immediate remediation required"
  else
    check_control "HIPAA-02" "PHI Data Flow" "WARN" "No obvious PHI in logs — verify with complete PHI data flow mapping"
  fi

  # HIPAA-03: Minimum Necessary
  if grep -r "SELECT \*" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" --include="*.sql" 2>/dev/null | grep -v "migrations" | head -1 > /dev/null 2>&1; then
    check_control "HIPAA-03" "Minimum Necessary Standard" "WARN" "Found SELECT * queries — verify they don't return unnecessary PHI fields"
  else
    check_control "HIPAA-03" "Minimum Necessary Standard" "PASS" "No SELECT * queries found"
  fi

  # HIPAA-04: BAAs
  if find "$TARGET" -maxdepth 3 -iname "*baa*" -o -iname "*business*associate*" 2>/dev/null | head -1 | grep -q .; then
    check_control "HIPAA-04" "Business Associate Agreements" "PASS" "BAA documentation found"
  else
    check_control "HIPAA-04" "Business Associate Agreements" "FAIL" "No BAA documentation found — required for all vendors handling PHI"
  fi

  # HIPAA-05: Workforce Training
  if find "$TARGET" -maxdepth 3 -iname "*training*" -o -iname "*hipaa*train*" 2>/dev/null | head -1 | grep -q .; then
    check_control "HIPAA-05" "Workforce Training" "PASS" "Training materials found"
  else
    check_control "HIPAA-05" "Workforce Training" "FAIL" "No HIPAA training materials found"
  fi

  # HIPAA-07: Breach Notification
  if find "$TARGET" -maxdepth 3 -iname "*breach*" 2>/dev/null | head -1 | grep -q .; then
    check_control "HIPAA-07" "Breach Notification" "PASS" "Breach notification procedures found"
  else
    check_control "HIPAA-07" "Breach Notification" "FAIL" "No breach notification procedures found"
  fi

  # HIPAA-08: Physical Safeguards
  check_control "HIPAA-08" "Physical Safeguards" "MANUAL" "Cannot audit via code — checklist generated for manual review"

  # HIPAA-09: Integrity Controls
  if grep -r "constraint\|CHECK\|NOT NULL\|FOREIGN KEY\|validate\|sanitize" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" --include="*.sql" 2>/dev/null | head -1 > /dev/null 2>&1; then
    check_control "HIPAA-09" "Integrity Controls" "PASS" "Data integrity controls detected in code"
  else
    check_control "HIPAA-09" "Integrity Controls" "WARN" "Limited data integrity controls detected — verify validation and constraints"
  fi

  echo ""
fi

if [[ "$FRAMEWORK" == "soc2" || "$FRAMEWORK" == "all" ]]; then
  echo "--- Checking SOC2-Specific Controls ---"
  echo ""

  # SOC2-01: Control Environment
  if find "$TARGET" -maxdepth 3 -iname "*code*of*conduct*" -o -iname "*ethics*" 2>/dev/null | head -1 | grep -q .; then
    check_control "SOC2-01" "Control Environment" "PASS" "Code of conduct / ethics documentation found"
  else
    check_control "SOC2-01" "Control Environment" "FAIL" "No code of conduct found — required for SOC2"
  fi

  # SOC2-03: Risk Assessment
  if find "$TARGET" -maxdepth 3 -iname "*risk*assess*" -o -iname "*risk*register*" 2>/dev/null | head -1 | grep -q .; then
    check_control "SOC2-03" "Risk Assessment" "PASS" "Risk assessment documentation found"
  else
    check_control "SOC2-03" "Risk Assessment" "FAIL" "No risk assessment found — must be conducted annually"
  fi

  # SOC2-04: Monitoring
  if grep -r "monitor\|alert\|metric\|prometheus\|grafana\|datadog\|newrelic\|sentry" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" --include="*.yml" --include="*.yaml" -l 2>/dev/null | head -1 > /dev/null 2>&1; then
    check_control "SOC2-04" "Monitoring Activities" "PASS" "Monitoring/alerting tools detected"
  else
    check_control "SOC2-04" "Monitoring Activities" "WARN" "No monitoring/alerting tools detected — verify monitoring infrastructure"
  fi

  # SOC2-07: Availability
  if find "$TARGET" -maxdepth 3 -iname "*disaster*recovery*" -o -iname "*business*continuity*" -o -iname "*bcp*" -o -iname "*drp*" 2>/dev/null | head -1 | grep -q .; then
    check_control "SOC2-07" "Availability" "PASS" "Business continuity / disaster recovery documentation found"
  else
    check_control "SOC2-07" "Availability" "FAIL" "No BCP/DRP found — required for SOC2 Availability criteria"
  fi

  # SOC2-08: Processing Integrity
  if grep -r "validate\|sanitize\|escape\|parameterized\|prepared.*statement" "$TARGET" "${GREP_EXCLUDES[@]}" --include="*.js" --include="*.ts" --include="*.py" -l 2>/dev/null | head -1 > /dev/null 2>&1; then
    check_control "SOC2-08" "Processing Integrity" "PASS" "Input validation / sanitization detected"
  else
    check_control "SOC2-08" "Processing Integrity" "WARN" "Limited input validation detected — verify all user inputs are validated"
  fi

  # SOC2-10: Privacy
  if find "$TARGET" -maxdepth 3 -iname "*privacy*policy*" -o -iname "*privacy*notice*" 2>/dev/null | head -1 | grep -q .; then
    check_control "SOC2-10" "Privacy" "PASS" "Privacy policy found"
  else
    check_control "SOC2-10" "Privacy" "WARN" "No privacy policy found — required if handling personal information"
  fi

  echo ""
fi

# --- Generate Report ---

if [[ $SCORE_TOTAL -gt 0 ]]; then
  SCORE_PCT=$(( (SCORE_PASS * 100) / SCORE_TOTAL ))
else
  SCORE_PCT=0
fi

READINESS="Unknown"
if [[ $SCORE_PCT -ge 90 ]]; then
  READINESS="Audit-Ready"
elif [[ $SCORE_PCT -ge 70 ]]; then
  READINESS="Minor Gaps"
elif [[ $SCORE_PCT -ge 50 ]]; then
  READINESS="Significant Gaps"
else
  READINESS="Major Gaps"
fi

REPORT_FILE="$OUTPUT_DIR/audit-report-$(echo "$FRAMEWORK" | tr '[:upper:]' '[:lower:]')-$(date +%Y%m%d).md"

cat > "$REPORT_FILE" << REPORT_EOF
# Compliance Audit Report

**Framework:** $FRAMEWORK
**Target:** $(cd "$TARGET" && pwd)
**Date:** $TIMESTAMP
**Score:** $SCORE_PASS / $SCORE_TOTAL ($SCORE_PCT%)
**Readiness:** $READINESS

## Summary

| Controls Checked | Passed | Score | Readiness |
|-----------------|--------|-------|-----------|
| $SCORE_TOTAL | $SCORE_PASS | $SCORE_PCT% | $READINESS |

## Detailed Results

| Control ID | Control Name | Status | Detail |
|-----------|-------------|--------|--------|
$(echo -e "$RESULTS")

## Next Steps

$(if [[ $SCORE_PCT -lt 70 ]]; then
echo "1. Run \`skills/audit-compliance/implement.sh $FRAMEWORK\` to generate missing policies and controls"
echo "2. Address all FAIL items — these are compliance blockers"
echo "3. Review WARN items — these may need attention"
echo "4. Complete MANUAL items — these require human verification"
echo "5. Re-run this audit after remediation"
elif [[ $SCORE_PCT -lt 90 ]]; then
echo "1. Address remaining FAIL and WARN items"
echo "2. Complete MANUAL verification items"
echo "3. Re-run audit to confirm readiness"
else
echo "1. Complete any remaining MANUAL verification items"
echo "2. Schedule auditor engagement (SOC2) or file compliance attestation (HIPAA)"
echo "3. Set up continuous monitoring: \`skills/audit-compliance/monitor.sh $FRAMEWORK\`"
fi)

---
*Generated by Compliance Skill — $(date -u +"%Y-%m-%d %H:%M UTC")*
REPORT_EOF

echo "=== Audit Complete ==="
echo ""
echo "Score: $SCORE_PASS / $SCORE_TOTAL ($SCORE_PCT%) — $READINESS"
echo "Report: $REPORT_FILE"
