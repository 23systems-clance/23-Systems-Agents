#!/usr/bin/env bash
set -euo pipefail

FRAMEWORK="${1:?Usage: implement.sh <soc2|hipaa|all> [target-path]}"
TARGET="${2:-.}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$TARGET/compliance-output/$FRAMEWORK"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DATE_ONLY=$(date -u +"%Y-%m-%d")

FRAMEWORK=$(echo "$FRAMEWORK" | tr '[:upper:]' '[:lower:]')

if [[ "$FRAMEWORK" != "soc2" && "$FRAMEWORK" != "hipaa" && "$FRAMEWORK" != "all" ]]; then
  echo "Error: Framework must be 'soc2', 'hipaa', or 'all'"
  exit 1
fi

echo "=== Compliance Implementation ==="
echo "Framework: $FRAMEWORK"
echo "Target: $(cd "$TARGET" && pwd)"
echo "Output: $OUTPUT_DIR/"
echo ""

generate_common_policies() {
  local dir="$1/common"
  mkdir -p "$dir"

  echo "Generating common policies..."

  cat > "$dir/information-security-policy.md" << 'EOF'
# Information Security Policy

## Purpose
This policy establishes the framework for protecting organizational information assets and ensuring the confidentiality, integrity, and availability of all data.

## Scope
This policy applies to all workforce members, contractors, and third parties with access to organizational systems and data.

## Policy Statements

### 1. Data Protection
- All sensitive data must be encrypted at rest (AES-256 minimum) and in transit (TLS 1.2+)
- Data must be classified according to the Data Classification Policy
- Access to data must follow the principle of least privilege

### 2. Access Control
- All access must be role-based and authorized by management
- Multi-factor authentication is required for all privileged accounts
- Access reviews must be conducted quarterly
- Access must be revoked within 24 hours of role change or termination

### 3. System Security
- All systems must be patched within defined SLAs (critical: 48h, high: 7d, medium: 30d)
- Vulnerability scanning must be performed continuously via CI/CD
- Annual penetration testing is required

### 4. Incident Management
- All security incidents must be reported immediately to the security team
- Incidents must be classified, investigated, and resolved per the Incident Response Plan
- Post-incident reviews must be conducted for all P0-P2 incidents

### 5. Change Management
- All changes to production systems must go through the change management process
- Changes must be reviewed, tested, and approved before deployment
- Emergency changes must be documented and reviewed within 48 hours

## Enforcement
Violations of this policy may result in disciplinary action up to and including termination.

## Review
This policy must be reviewed and updated annually or when significant changes occur.

---
*Last Updated: POLICY_DATE*
*Next Review: REVIEW_DATE*
*Owner: [Security Officer Name]*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g; s/REVIEW_DATE/$(date -u -v+1y +%Y-%m-%d 2>/dev/null || date -u -d '+1 year' +%Y-%m-%d 2>/dev/null || echo 'NEXT_YEAR')/g" "$dir/information-security-policy.md" 2>/dev/null && rm -f "$dir/information-security-policy.md.bak" || true

  cat > "$dir/access-control-policy.md" << 'EOF'
# Access Control Policy

## Purpose
Define requirements for controlling access to organizational systems and data.

## Role Definitions

| Role | Access Level | Approval Required |
|------|-------------|-------------------|
| Read-Only | View data only | Team lead |
| Standard User | Read + write within scope | Team lead |
| Power User | Extended access for specific functions | Department head |
| Administrator | Full system access | Security officer + VP |
| Super Admin | Infrastructure + all systems | CTO/CEO |

## Access Lifecycle

### Provisioning
1. Manager submits access request with business justification
2. Approver reviews and approves/denies
3. IT provisions access per role definition
4. User completes security training before access is granted

### Modification
1. Role change triggers access review
2. Previous access removed, new access provisioned
3. Documented in access log

### Revocation
1. Employment termination: access revoked within 24 hours
2. Role change: previous access revoked within 48 hours
3. Extended leave (>30 days): access suspended

## Access Reviews
- Quarterly review of all user access
- Annual certification of privileged access
- Immediate review after security incidents

## Password Requirements
- Minimum 12 characters
- Complexity: uppercase, lowercase, number, special character
- No password reuse (last 12 passwords)
- Maximum age: 90 days (or passwordless with MFA)

## Multi-Factor Authentication
Required for:
- All privileged/admin accounts
- Remote access / VPN
- Access to sensitive data stores
- Cloud console access

---
*Last Updated: POLICY_DATE*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g" "$dir/access-control-policy.md" 2>/dev/null && rm -f "$dir/access-control-policy.md.bak" || true

  cat > "$dir/incident-response-plan.md" << 'EOF'
# Incident Response Plan

## 1. Incident Classification

| Severity | Description | Response Time | Example |
|----------|-------------|---------------|---------|
| P0 — Critical | Active breach, data loss, system-wide outage | 15 minutes | Ransomware, active exfiltration |
| P1 — High | Confirmed vulnerability exploited, partial outage | 1 hour | SQL injection discovered in prod |
| P2 — Medium | Suspicious activity, potential vulnerability | 4 hours | Unusual login patterns |
| P3 — Low | Minor policy violation, informational | 24 hours | Failed phishing attempt blocked |

## 2. Response Team

| Role | Responsibility | Contact |
|------|---------------|---------|
| Incident Commander | Leads response, makes decisions | [Name / Contact] |
| Technical Lead | Investigation and containment | [Name / Contact] |
| Communications Lead | Internal/external communications | [Name / Contact] |
| Legal Counsel | Legal and regulatory guidance | [Name / Contact] |
| Executive Sponsor | Business decisions, resource allocation | [Name / Contact] |

## 3. Response Phases

### Phase 1: Detection & Reporting
- Any workforce member who detects a potential incident must report immediately
- Report to: [security email/channel]
- Include: what happened, when, affected systems, current impact

### Phase 2: Triage & Classification
- Incident Commander classifies severity
- Assemble response team appropriate to severity
- Begin incident log (timestamped actions)

### Phase 3: Containment
- Short-term: isolate affected systems, block attack vector
- Long-term: apply patches, strengthen controls
- Preserve evidence (logs, memory dumps, disk images)

### Phase 4: Eradication
- Remove root cause (malware, compromised accounts, vulnerable code)
- Verify removal across all affected systems
- Update detection signatures

### Phase 5: Recovery
- Restore systems from known-good backups
- Monitor for re-infection
- Gradually restore access
- Verify system integrity

### Phase 6: Post-Incident Review
- Conduct within 72 hours of resolution
- Document: timeline, root cause, actions taken, lessons learned
- Update controls and procedures based on findings
- File regulatory notifications if required

## 4. Communication Templates

### Internal Notification
Subject: [SEVERITY] Security Incident — [Brief Description]
Body: An incident has been detected affecting [systems]. The response team has been activated. [Current status]. Do not [specific instructions]. Updates will be provided every [frequency].

### External Notification (if required)
[To be drafted by Communications Lead with Legal Counsel approval]

## 5. Regulatory Notification Requirements
- HIPAA: 60 days from discovery for breaches affecting 500+ individuals
- State breach notification laws: varies (typically 30-60 days)
- Contractual obligations: per customer/vendor agreements

---
*Last Updated: POLICY_DATE*
*Annual Test Due: TEST_DATE*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g; s/TEST_DATE/$(date -u -v+1y +%Y-%m-%d 2>/dev/null || date -u -d '+1 year' +%Y-%m-%d 2>/dev/null || echo 'NEXT_YEAR')/g" "$dir/incident-response-plan.md" 2>/dev/null && rm -f "$dir/incident-response-plan.md.bak" || true

  cat > "$dir/change-management-policy.md" << 'EOF'
# Change Management Policy

## Purpose
Ensure all changes to production systems are planned, tested, approved, and documented.

## Change Types

| Type | Approval | Lead Time | Example |
|------|----------|-----------|---------|
| Standard | Pre-approved | None | Dependency update, config tweak |
| Normal | Peer review + lead | 24 hours | New feature, schema change |
| Significant | CAB review | 1 week | Architecture change, new integration |
| Emergency | Post-facto review | Immediate | Active incident hotfix |

## Process

### 1. Request
- Create change request (PR/ticket) with: description, risk assessment, rollback plan, testing evidence

### 2. Review
- Code review by qualified peer
- Security review for changes touching auth, data access, or external APIs
- Test results attached

### 3. Approval
- Standard: auto-approved if CI passes
- Normal: team lead approval
- Significant: Change Advisory Board review
- Emergency: any senior engineer, documented within 48 hours

### 4. Implementation
- Deploy during approved maintenance window (or anytime for standard changes)
- Monitor for 30 minutes post-deploy
- Verify rollback capability

### 5. Documentation
- All changes tracked in version control (git)
- Release notes for significant changes
- Post-implementation review for significant/emergency changes

---
*Last Updated: POLICY_DATE*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g" "$dir/change-management-policy.md" 2>/dev/null && rm -f "$dir/change-management-policy.md.bak" || true

  cat > "$dir/data-classification-policy.md" << 'EOF'
# Data Classification Policy

## Classification Levels

| Level | Description | Examples | Controls |
|-------|-------------|----------|----------|
| **Public** | No impact if disclosed | Marketing materials, public docs | None required |
| **Internal** | Minor impact if disclosed | Internal memos, non-sensitive configs | Access control |
| **Confidential** | Significant impact if disclosed | Customer data, financials, source code | Encryption + access control + logging |
| **Restricted** | Severe impact if disclosed | PHI, PII, credentials, keys | Encryption + strict access + audit logging + retention limits |

## Handling Requirements

### Storage
- Public: any storage
- Internal: access-controlled storage
- Confidential: encrypted storage, access-controlled
- Restricted: encrypted storage, strict access, audit logging

### Transmission
- Public: any channel
- Internal: internal channels only
- Confidential: encrypted channels (HTTPS, encrypted email)
- Restricted: encrypted channels, no email unless encrypted

### Disposal
- Public: standard deletion
- Internal: standard deletion
- Confidential: secure deletion (overwrite or crypto-shred)
- Restricted: secure deletion with verification, certificate of destruction

### Labeling
- All documents and data stores should indicate their classification level
- Default classification: Internal (if not explicitly classified)

---
*Last Updated: POLICY_DATE*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g" "$dir/data-classification-policy.md" 2>/dev/null && rm -f "$dir/data-classification-policy.md.bak" || true

  echo "  [done] 5 common policies generated"
}

generate_soc2_policies() {
  local dir="$1/soc2"
  mkdir -p "$dir"

  echo "Generating SOC2-specific documents..."

  cat > "$dir/system-description.md" << 'EOF'
# System Description (SOC2 Section III)

## 1. Overview of the Organization

**Company Name:** [Organization Name]
**Services Provided:** [Description of services]
**Reporting Period:** [Start Date] to [End Date]

## 2. Principal Service Commitments and System Requirements

### Service Commitments
[Describe commitments made to customers regarding security, availability, processing integrity, confidentiality, and privacy]

### System Requirements
[Describe system requirements needed to meet service commitments]

## 3. Components of the System

### Infrastructure
| Component | Description | Provider |
|-----------|-------------|----------|
| Compute | [e.g., AWS EC2, GCP Compute] | [Provider] |
| Database | [e.g., PostgreSQL on RDS] | [Provider] |
| Storage | [e.g., S3, GCS] | [Provider] |
| CDN | [e.g., CloudFront, Cloudflare] | [Provider] |
| DNS | [e.g., Route53, Cloudflare] | [Provider] |

### Software
| Component | Purpose | Version |
|-----------|---------|---------|
| [App framework] | [Purpose] | [Version] |
| [Database] | [Purpose] | [Version] |
| [Other] | [Purpose] | [Version] |

### People
| Role | Responsibility |
|------|---------------|
| Engineering | Design, develop, and maintain systems |
| Operations | Deploy, monitor, and maintain infrastructure |
| Security | Security policies, incident response, compliance |
| Management | Oversight, resource allocation, risk management |

### Processes
- Software Development Lifecycle (SDLC)
- Change Management
- Incident Response
- Access Management
- Vulnerability Management
- Business Continuity

### Data
| Data Type | Classification | Storage | Encryption |
|-----------|---------------|---------|------------|
| [Type] | [Level] | [Where] | [Yes/No] |

## 4. Boundaries of the System
[Define what is in scope and out of scope for the SOC2 examination]

## 5. Relevant Aspects of the Control Environment, Risk Assessment, Monitoring, and Information & Communication

### Control Environment
[Describe organizational commitment to security]

### Risk Assessment
[Describe risk assessment process]

### Monitoring
[Describe monitoring activities]

### Information & Communication
[Describe how security information is communicated]

## 6. Complementary User Entity Controls (CUECs)
[Controls that customers must implement for the system to meet its service commitments]

## 7. Complementary Subservice Organization Controls (CSOCs)
[Controls that subservice organizations (e.g., AWS) must implement]

---
*This document should be reviewed and updated for each audit period.*
EOF

  cat > "$dir/risk-assessment-report.md" << 'EOF'
# Risk Assessment Report

**Assessment Date:** [Date]
**Assessor:** [Name/Role]
**Review Period:** Annual

## Methodology
Risk = Likelihood (1-5) x Impact (1-5)

| Score | Likelihood | Impact |
|-------|-----------|--------|
| 1 | Rare | Negligible |
| 2 | Unlikely | Minor |
| 3 | Possible | Moderate |
| 4 | Likely | Major |
| 5 | Almost Certain | Severe |

| Risk Score | Rating | Action Required |
|-----------|--------|----------------|
| 1-5 | Low | Accept or monitor |
| 6-12 | Medium | Mitigate within 90 days |
| 13-19 | High | Mitigate within 30 days |
| 20-25 | Critical | Immediate action required |

## Risk Register

| ID | Risk | Category | Likelihood | Impact | Score | Treatment | Owner | Due Date | Status |
|----|------|----------|-----------|--------|-------|-----------|-------|----------|--------|
| R-001 | Unauthorized access to production systems | Security | | | | | | | |
| R-002 | Data breach via application vulnerability | Security | | | | | | | |
| R-003 | Service outage due to infrastructure failure | Availability | | | | | | | |
| R-004 | Data loss due to backup failure | Availability | | | | | | | |
| R-005 | Insider threat / privilege abuse | Security | | | | | | | |
| R-006 | Third-party vendor compromise | Security | | | | | | | |
| R-007 | Phishing / social engineering attack | Security | | | | | | | |
| R-008 | Regulatory non-compliance | Compliance | | | | | | | |
| R-009 | Data integrity issues from software bugs | Integrity | | | | | | | |
| R-010 | Loss of key personnel | Operational | | | | | | | |

## Treatment Plans

### R-001: Unauthorized Access
**Current Controls:** [List existing controls]
**Gap:** [Identified gap]
**Treatment:** [Planned remediation]
**Timeline:** [Due date]

[Repeat for each risk requiring treatment]

---
*Next Assessment Due: [Date + 1 year]*
EOF

  cat > "$dir/vendor-management-policy.md" << 'EOF'
# Vendor Management Policy

## Purpose
Ensure third-party vendors meet security requirements and do not introduce unacceptable risk.

## Vendor Classification

| Tier | Criteria | Review Frequency | Requirements |
|------|----------|-----------------|--------------|
| Critical | Handles sensitive data or is essential to operations | Quarterly | SOC2/ISO 27001 + BAA + SLA |
| Important | Handles internal data or supports operations | Annually | Security questionnaire + SLA |
| Standard | No data access, replaceable | Biannually | Terms of service review |

## Vendor Onboarding
1. Complete vendor risk assessment questionnaire
2. Review vendor's security certifications (SOC2, ISO 27001, HIPAA)
3. Execute appropriate agreements (NDA, BAA, DPA as applicable)
4. Define SLAs and security requirements
5. Document in vendor inventory

## Vendor Inventory

| Vendor | Service | Tier | Data Access | Certifications | Agreement | Last Review |
|--------|---------|------|------------|----------------|-----------|-------------|
| [Name] | [Service] | [Tier] | [What data] | [Certs] | [Type] | [Date] |

## Ongoing Monitoring
- Review vendor certifications annually
- Monitor for security incidents affecting vendors
- Re-assess vendor risk upon contract renewal
- Maintain right to audit clause in agreements

---
*Last Updated: POLICY_DATE*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g" "$dir/vendor-management-policy.md" 2>/dev/null && rm -f "$dir/vendor-management-policy.md.bak" || true

  cat > "$dir/business-continuity-plan.md" << 'EOF'
# Business Continuity Plan

## 1. Recovery Objectives

| System | RTO (Recovery Time) | RPO (Recovery Point) | Priority |
|--------|--------------------|--------------------|----------|
| Production Application | [e.g., 4 hours] | [e.g., 1 hour] | Critical |
| Database | [e.g., 2 hours] | [e.g., 15 minutes] | Critical |
| Email / Communication | [e.g., 8 hours] | [e.g., 24 hours] | High |
| Internal Tools | [e.g., 24 hours] | [e.g., 24 hours] | Medium |

## 2. Disaster Recovery Procedures

### Database Recovery
1. Identify most recent clean backup
2. Restore to standby environment
3. Verify data integrity
4. Switch DNS / load balancer to standby
5. Verify application functionality
6. Monitor for 1 hour

### Application Recovery
1. Deploy from last known-good release
2. Verify all dependencies available
3. Run smoke tests
4. Restore traffic
5. Monitor for 1 hour

### Full Infrastructure Recovery
1. Provision new infrastructure (IaC / Terraform)
2. Restore database from backup
3. Deploy application
4. Update DNS records
5. Verify end-to-end functionality
6. Notify stakeholders

## 3. Communication Plan

| Audience | Channel | Timing | Owner |
|----------|---------|--------|-------|
| Response team | [Slack/PagerDuty] | Immediate | Incident Commander |
| All employees | [Email/Slack] | Within 1 hour | Communications Lead |
| Customers | [Status page/Email] | Within 2 hours | Communications Lead |
| Regulators | [Per requirements] | Per regulatory timeline | Legal |

## 4. Testing Schedule
- **Tabletop exercise:** Quarterly
- **Backup restore test:** Monthly
- **Full DR test:** Annually

---
*Last Updated: POLICY_DATE*
*Next DR Test Due: [Date]*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g" "$dir/business-continuity-plan.md" 2>/dev/null && rm -f "$dir/business-continuity-plan.md.bak" || true

  echo "  [done] 4 SOC2 documents generated"
}

generate_hipaa_policies() {
  local dir="$1/hipaa"
  mkdir -p "$dir"

  echo "Generating HIPAA-specific documents..."

  # Security Risk Assessment
  cp "$SCRIPT_DIR/templates/sra-template.md" "$dir/security-risk-assessment.md" 2>/dev/null || cat > "$dir/security-risk-assessment.md" << 'EOF'
# HIPAA Security Risk Assessment (SRA)

**Organization:** [Organization Name]
**Assessment Date:** [Date]
**Assessor:** [Name / Role]
**Review Period:** Annual (required by 45 CFR 164.308(a)(1)(ii)(A))

## 1. Scope

This assessment covers all electronic Protected Health Information (ePHI) created, received, maintained, or transmitted by [Organization Name].

## 2. ePHI Inventory

| System/Application | ePHI Types | Storage Location | Users | Encryption |
|-------------------|-----------|-----------------|-------|------------|
| [App name] | [PHI fields] | [Where stored] | [Who] | [Yes/No] |

## 3. Threat Assessment

| Threat Source | Threat Action | Affected Assets | Likelihood (1-5) |
|--------------|--------------|----------------|-------------------|
| External attacker | Exploit web vulnerability | Application, database | |
| External attacker | Phishing | Employee accounts | |
| Internal user | Unauthorized access to PHI | Database, application | |
| Internal user | Accidental disclosure | Email, messaging | |
| Environmental | Natural disaster | On-premise infrastructure | |
| Technical | System failure | All systems | |
| Third party | Vendor breach | Shared data | |

## 4. Vulnerability Assessment

| Vulnerability | Affected System | Current Controls | Residual Risk |
|--------------|----------------|-----------------|---------------|
| Unpatched software | [System] | [Controls] | [H/M/L] |
| Weak authentication | [System] | [Controls] | [H/M/L] |
| Insufficient logging | [System] | [Controls] | [H/M/L] |
| Lack of encryption | [System] | [Controls] | [H/M/L] |
| Excessive access | [System] | [Controls] | [H/M/L] |

## 5. Risk Matrix

Risk = Likelihood x Impact

| | Impact 1 | Impact 2 | Impact 3 | Impact 4 | Impact 5 |
|---|---------|---------|---------|---------|---------|
| **Likelihood 5** | 5 | 10 | 15 | 20 | 25 |
| **Likelihood 4** | 4 | 8 | 12 | 16 | 20 |
| **Likelihood 3** | 3 | 6 | 9 | 12 | 15 |
| **Likelihood 2** | 2 | 4 | 6 | 8 | 10 |
| **Likelihood 1** | 1 | 2 | 3 | 4 | 5 |

## 6. Risk Register

| ID | Risk Description | Likelihood | Impact | Risk Score | Current Controls | Treatment | Owner | Due Date |
|----|-----------------|-----------|--------|-----------|-----------------|-----------|-------|----------|
| H-001 | | | | | | | | |
| H-002 | | | | | | | | |

## 7. HIPAA Security Rule Compliance Checklist

### Administrative Safeguards (164.308)
- [ ] Security Management Process (risk analysis, risk management, sanctions, review)
- [ ] Assigned Security Responsibility (designated security officer)
- [ ] Workforce Security (authorization, clearance, termination procedures)
- [ ] Information Access Management (access authorization, establishment, modification)
- [ ] Security Awareness & Training (reminders, malware protection, login monitoring, password management)
- [ ] Security Incident Procedures (response and reporting)
- [ ] Contingency Plan (backup, recovery, emergency mode, testing)
- [ ] Evaluation (periodic technical and non-technical evaluation)
- [ ] BAAs (business associate contracts)

### Physical Safeguards (164.310)
- [ ] Facility Access Controls (contingency operations, facility security plan, access control, maintenance records)
- [ ] Workstation Use (policies for workstation use)
- [ ] Workstation Security (physical safeguards for workstations)
- [ ] Device & Media Controls (disposal, re-use, accountability, backup)

### Technical Safeguards (164.312)
- [ ] Access Control (unique user ID, emergency access, automatic logoff, encryption)
- [ ] Audit Controls (hardware, software, procedural mechanisms)
- [ ] Integrity (ePHI alteration/destruction protection)
- [ ] Person/Entity Authentication (verify identity of users)
- [ ] Transmission Security (integrity controls, encryption)

## 8. Remediation Plan

| Priority | Risk ID | Remediation Action | Responsible | Target Date | Status |
|----------|---------|-------------------|-------------|-------------|--------|
| Critical | | | | | |
| High | | | | | |
| Medium | | | | | |

## 9. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Security Officer | | | |
| Privacy Officer | | | |
| Management | | | |

---
*This SRA must be updated annually or when significant changes occur to the organization's ePHI environment.*
EOF

  cat > "$dir/privacy-policy-phi.md" << 'EOF'
# PHI Privacy Policy

## Notice of Privacy Practices

### How We Use and Disclose PHI

**Treatment:** We may use/disclose PHI for treatment purposes.
**Payment:** We may use/disclose PHI for payment activities.
**Healthcare Operations:** We may use/disclose PHI for operational purposes.

### Your Rights
- **Access:** You may request access to your PHI
- **Amendment:** You may request changes to your PHI
- **Accounting:** You may request a list of disclosures
- **Restriction:** You may request restrictions on use/disclosure
- **Confidential Communication:** You may request alternative communication methods
- **Breach Notification:** You will be notified of breaches affecting your PHI

### Our Responsibilities
- Maintain the privacy of your PHI
- Provide you with this notice of privacy practices
- Follow the terms of this notice
- Notify you of breaches of unsecured PHI

### Minimum Necessary Standard
We limit PHI use, disclosure, and requests to the minimum necessary to accomplish the intended purpose.

### Contact
Privacy Officer: [Name]
Email: [Email]
Phone: [Phone]

---
*Effective Date: [Date]*
*Last Updated: POLICY_DATE*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g" "$dir/privacy-policy-phi.md" 2>/dev/null && rm -f "$dir/privacy-policy-phi.md.bak" || true

  cat > "$dir/breach-notification-procedures.md" << 'EOF'
# Breach Notification Procedures

## Definition of Breach
An impermissible use or disclosure under the Privacy Rule that compromises the security or privacy of PHI. Presumed to be a breach unless a risk assessment demonstrates low probability of compromise.

## 4-Factor Risk Assessment
When a potential breach is identified, assess:
1. **Nature and extent of PHI involved** (types of identifiers, likelihood of re-identification)
2. **Unauthorized person who used/received PHI** (known entity? ability to retain PHI?)
3. **Whether PHI was actually acquired or viewed** (vs. opportunity to view)
4. **Extent of mitigation** (PHI retrieved? unauthorized person provided assurances?)

## Notification Requirements

### Individual Notice
- **When:** Within 60 calendar days of discovery
- **Method:** First-class mail (or email if individual agreed)
- **Content:** Description of breach, types of PHI involved, steps to protect self, what we're doing, contact info
- **Substitute notice:** If 10+ individuals with insufficient contact info → prominent website posting + major media

### HHS Notification
- **500+ individuals:** Within 60 days via HHS breach portal
- **Fewer than 500:** Annual log submitted within 60 days of calendar year end

### Media Notification
- **When:** Breach affects 500+ individuals in a single state/jurisdiction
- **Method:** Prominent media outlet in the state/jurisdiction
- **Timing:** Within 60 days of discovery

## Breach Documentation
Maintain for 6 years:
- Date of breach discovery
- Nature and extent of PHI
- Individuals affected
- Risk assessment results
- Notifications sent (copies with dates)
- Corrective actions taken

---
*Last Updated: POLICY_DATE*
EOF
  sed -i.bak "s/POLICY_DATE/$DATE_ONLY/g" "$dir/breach-notification-procedures.md" 2>/dev/null && rm -f "$dir/breach-notification-procedures.md.bak" || true

  cat > "$dir/baa-template.md" << 'EOF'
# Business Associate Agreement Template

**Between:** [Covered Entity Name] ("Covered Entity")
**And:** [Business Associate Name] ("Business Associate")
**Effective Date:** [Date]

## 1. Definitions
Terms used in this Agreement have the meaning set forth in 45 CFR Parts 160 and 164.

## 2. Obligations of Business Associate
Business Associate agrees to:
- Not use or disclose PHI other than as permitted by this Agreement or as required by law
- Use appropriate safeguards to prevent unauthorized use or disclosure of PHI
- Report any unauthorized use or disclosure (including breaches) within 24 hours of discovery
- Ensure any subcontractors agree to the same restrictions
- Make PHI available to individuals per their right of access
- Make PHI available for amendment
- Maintain and make available accounting of disclosures
- Make internal practices and records available to HHS
- Return or destroy all PHI at termination

## 3. Permitted Uses and Disclosures
Business Associate may use/disclose PHI only for:
- [Specify permitted purposes]
- Proper management and administration of Business Associate
- Data aggregation services (if applicable)

## 4. Term and Termination
- **Term:** Effective until terminated
- **Termination for cause:** If either party violates a material term
- **Effect of termination:** Return or destroy all PHI; if not feasible, protections extend indefinitely

## 5. Breach Notification
Business Associate shall notify Covered Entity of any breach of unsecured PHI within 24 hours of discovery, including:
- Nature and extent of PHI involved
- Individuals affected (if known)
- Steps taken to investigate and mitigate

---
*This template must be reviewed by legal counsel before use.*
EOF

  cat > "$dir/workforce-training-materials.md" << 'EOF'
# HIPAA Workforce Training Materials

## Module 1: HIPAA Overview
- What is HIPAA? (Health Insurance Portability and Accountability Act of 1996)
- Who must comply? (Covered Entities and Business Associates)
- What is PHI? (Any individually identifiable health information)
- The three HIPAA Rules: Privacy, Security, Breach Notification

## Module 2: What is PHI?
PHI includes any health information that can identify an individual:

### 18 HIPAA Identifiers
1. Names
2. Geographic data (smaller than state)
3. Dates (except year) related to individual
4. Phone numbers
5. Fax numbers
6. Email addresses
7. Social Security numbers
8. Medical record numbers
9. Health plan beneficiary numbers
10. Account numbers
11. Certificate/license numbers
12. Vehicle identifiers and serial numbers
13. Device identifiers and serial numbers
14. Web URLs
15. IP addresses
16. Biometric identifiers
17. Full-face photographs
18. Any other unique identifying number

## Module 3: Your Responsibilities
- Access only the PHI you need for your job (Minimum Necessary)
- Never share PHI via unsecured channels (personal email, text, social media)
- Lock your workstation when stepping away
- Report any suspected breach immediately
- Do not discuss PHI in public areas
- Verify identity before disclosing PHI
- Dispose of PHI securely (shred paper, secure delete digital)

## Module 4: Common Violations
- Snooping in records you don't need for your job
- Sharing login credentials
- Sending PHI via unencrypted email
- Leaving PHI visible on unattended screens
- Discussing patients in public areas
- Taking photos of PHI on personal devices
- Posting about patients on social media

## Module 5: Breach Reporting
If you suspect a breach:
1. Report immediately to: [Security Officer / Privacy Officer]
2. Do not attempt to investigate on your own
3. Do not notify the affected individual (that's the organization's responsibility)
4. Document what you observed

## Training Acknowledgment
I acknowledge that I have completed HIPAA training and understand my responsibilities.

Name: _______________
Date: _______________
Signature: _______________

---
*Training must be completed upon hire and annually thereafter.*
EOF

  echo "  [done] 5 HIPAA documents generated"
}

# Generate policies based on framework

if [[ "$FRAMEWORK" == "soc2" || "$FRAMEWORK" == "all" ]]; then
  generate_common_policies "$OUTPUT_DIR"
  generate_soc2_policies "$OUTPUT_DIR"
fi

if [[ "$FRAMEWORK" == "hipaa" || "$FRAMEWORK" == "all" ]]; then
  if [[ "$FRAMEWORK" == "hipaa" ]]; then
    generate_common_policies "$OUTPUT_DIR"
  fi
  generate_hipaa_policies "$OUTPUT_DIR"
fi

# Count generated files
FILE_COUNT=$(find "$OUTPUT_DIR" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo "=== Implementation Complete ==="
echo "Generated $FILE_COUNT documents in $OUTPUT_DIR/"
echo ""
echo "Next steps:"
echo "  1. Review and customize each document (fill in [bracketed] placeholders)"
echo "  2. Have legal counsel review BAA template and privacy policies"
echo "  3. Get management sign-off on policies"
echo "  4. Re-run audit: skills/compliance/audit.sh $FRAMEWORK"
echo "  5. Set up monitoring: skills/compliance/monitor.sh $FRAMEWORK"
