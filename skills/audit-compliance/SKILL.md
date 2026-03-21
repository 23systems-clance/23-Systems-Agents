---
name: audit-compliance
description: Audit SOC2 and HIPAA compliance, implement controls, and monitor for drift. Scans codebases for control gaps, generates policies, and produces auditor-ready reports.
---

# Audit Compliance

Unified compliance engine for SOC2 and HIPAA frameworks. Audits your codebase and infrastructure against regulatory requirements, generates missing policies and controls, and monitors for drift.

## Subcommands

### Audit — Gap Analysis

Scans the target application and produces a compliance readiness report.

```bash
skills/audit-compliance/audit.sh <framework> [target-path]
```

- `framework`: `soc2`, `hipaa`, or `all`
- `target-path`: Root of the application to audit (defaults to current directory)

**What it checks:**
- Encryption at rest and in transit
- Authentication and access controls
- Audit logging and monitoring
- Data retention and disposal
- Incident response procedures
- Vendor/BAA management (HIPAA)
- Change management (SOC2)
- Backup and availability controls

**Output:** Markdown report with pass/fail/warning per control, remediation steps for failures, and an overall readiness score.

### Implement — Policy & Control Generation

Generates missing policies, configuration, and code changes.

```bash
skills/audit-compliance/implement.sh <framework> [target-path]
```

**What it generates:**

#### Common (both frameworks)
- Information Security Policy
- Access Control Policy
- Encryption Policy
- Incident Response Plan
- Change Management Policy
- Data Classification Policy
- Audit logging configuration recommendations

#### SOC2-specific
- System Description (Section III)
- Risk Assessment Report
- Vendor Management Policy
- Business Continuity Plan
- Monitoring & Alerting Policy

#### HIPAA-specific
- Security Risk Assessment (SRA) — the #1 auditor requirement
- Privacy Policy (PHI handling)
- Breach Notification Procedures
- Business Associate Agreement template
- Workforce Training Materials
- PHI Inventory & Data Flow Map
- Minimum Necessary Standard Policy
- Facility Access Controls Policy

**Output:** Generated documents in `compliance-output/<framework>/` directory within the target project.

### Monitor — Continuous Compliance

Checks current state against previously established controls.

```bash
skills/audit-compliance/monitor.sh <framework> [target-path]
```

**What it monitors:**
- Encryption still enabled on all data stores
- Access controls haven't been weakened
- Audit logging still active and capturing required events
- No PHI/PII exposed in logs, environment variables, or code comments
- Required policies exist and are current (not stale >12 months)
- Dependencies don't have known vulnerabilities

**Output:** Status report with `PASS`, `DRIFT`, or `VIOLATION` per control. Non-zero exit code if any violations found.

## Setting Up Continuous Monitoring (Cron)

Add to `config/CRONS.json` for automated compliance checks:

```json
{
  "name": "Weekly Compliance Monitor",
  "schedule": "0 9 * * 1",
  "type": "agent",
  "job": "Run compliance monitoring for all frameworks: skills/audit-compliance/monitor.sh all . Then summarize any DRIFT or VIOLATION findings and create issues for remediation.",
  "enabled": true
}
```

## Framework Details

### SOC2 Trust Service Criteria

The audit maps controls to all 5 TSC categories:

| Category | What We Check |
|----------|--------------|
| **Security** (CC6) | Firewalls, encryption, auth, vulnerability management |
| **Availability** (A1) | Backups, disaster recovery, uptime monitoring |
| **Processing Integrity** (PI1) | Input validation, error handling, data accuracy |
| **Confidentiality** (C1) | Data classification, access restrictions, disposal |
| **Privacy** (P1-P8) | Consent, collection limitation, PHI/PII controls |

### HIPAA Safeguard Categories

| Category | What We Check |
|----------|--------------|
| **Administrative** (164.308) | Risk assessment, workforce training, contingency plan, BAAs |
| **Physical** (164.310) | Facility access (flagged for manual review), workstation security |
| **Technical** (164.312) | Access controls, audit controls, integrity controls, transmission security |

## When to Use

- **Starting a compliance initiative** — Run `audit.sh` first to understand your gap
- **Preparing for a SOC2 audit** — Run `implement.sh soc2` to generate all required documentation
- **Building a health-tech app** — Run `implement.sh hipaa` before handling any PHI
- **Ongoing compliance** — Set up `monitor.sh` as a cron job
- **Adding a new framework later** — Add a new `.md` file in `frameworks/` following the existing pattern

## Adding New Frameworks

To add PCI-DSS, ISO 27001, GDPR, etc.:

1. Create `skills/audit-compliance/frameworks/<framework>.md` with control requirements
2. Map shared controls from `common.md` (avoid duplication)
3. Add framework-specific checks and policy templates
4. The audit/implement/monitor scripts auto-discover framework files
