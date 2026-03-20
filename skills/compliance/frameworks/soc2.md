# SOC2 Framework — Trust Service Criteria

Framework-specific controls beyond the common controls in `common.md`.
Maps to AICPA Trust Service Criteria (2017).

---

## Shared Controls (from common.md)

These common controls satisfy the following SOC2 criteria:

| Common Control | SOC2 Criteria |
|---------------|---------------|
| CC-01 Encryption at Rest | CC6.1, C1.1 |
| CC-02 Encryption in Transit | CC6.1, CC6.7 |
| CC-03 Authentication | CC6.1, CC6.2 |
| CC-04 Access Control | CC6.1, CC6.2, CC6.3 |
| CC-05 Audit Logging | CC7.1, CC7.2 |
| CC-06 Incident Response | CC7.3, CC7.4, CC7.5 |
| CC-07 Change Management | CC8.1 |
| CC-08 Vulnerability Management | CC7.1 |
| CC-09 Backup & Recovery | A1.2, A1.3 |
| CC-10 Data Classification | C1.1, C1.2 |

---

## SOC2-01: Control Environment (CC1)

**Criteria:** CC1.1–CC1.5 — Organization demonstrates commitment to integrity, board oversight, management structures, accountability, and competence.

**Audit checks:**
- Code of conduct / ethics policy exists
- Organizational chart with security responsibilities defined
- Background checks for employees with system access
- Security awareness training program exists
- Board/management oversight of security documented

**Required documents:**
- Code of Conduct
- Organizational Security Chart
- Security Roles & Responsibilities Matrix
- Training program documentation

---

## SOC2-02: Communication & Information (CC2)

**Criteria:** CC2.1–CC2.3 — Organization communicates security information internally and externally.

**Audit checks:**
- Internal security communication process (security updates, policy changes)
- External communication process (security disclosures, customer notifications)
- System description document exists (required for SOC2 report)
- Security reporting channels (how employees report concerns)

**Required documents:**
- System Description (Section III of SOC2 report)
- Security Communication Policy
- Responsible Disclosure Policy (if applicable)

---

## SOC2-03: Risk Assessment (CC3)

**Criteria:** CC3.1–CC3.4 — Organization identifies and assesses risks, including fraud risk.

**Audit checks:**
- Formal risk assessment conducted (at least annually)
- Risk register maintained with identified risks, likelihood, impact
- Risk treatment plans documented (accept, mitigate, transfer, avoid)
- Fraud risk considered (privilege abuse, data theft, social engineering)
- Third-party/vendor risks assessed

**Required documents:**
- Risk Assessment Report
- Risk Register (with treatment plans)
- Vendor Risk Assessment template

---

## SOC2-04: Monitoring Activities (CC4)

**Criteria:** CC4.1–CC4.2 — Organization monitors controls and remediates deficiencies.

**Audit checks:**
- Infrastructure monitoring in place (uptime, performance, errors)
- Security monitoring active (IDS/IPS, anomaly detection, SIEM)
- Control effectiveness reviewed periodically
- Deficiencies tracked to resolution
- KPIs/metrics for security posture

**Required documents:**
- Monitoring & Alerting Policy
- Control Testing Schedule
- Deficiency Remediation Tracker

---

## SOC2-05: Logical & Physical Access (CC6)

**Criteria:** CC6.4–CC6.8 — Beyond common access controls.

**Audit checks:**
- System boundaries defined (network segmentation, firewalls)
- External access points inventoried and secured
- Data in transit protection verified across all channels
- Unauthorized access prevention (WAF, rate limiting, IP restrictions)
- Credential lifecycle management (creation, rotation, revocation)

**Required documents:**
- Network Architecture Diagram
- System Boundary Documentation
- Credential Management Policy

---

## SOC2-06: System Operations (CC7)

**Criteria:** CC7.1–CC7.5 — Detection, response, and recovery from security events.

**Audit checks (beyond CC-06 Incident Response):**
- Anomaly detection baseline established
- Security events correlated across systems
- Impact of incidents assessed and documented
- Recovery procedures tested
- Lessons learned incorporated into controls

**Required documents:**
- Security Event Classification Guide
- Incident Post-Mortem Template
- Recovery Procedures Runbook

---

## SOC2-07: Availability (A1)

**Criteria:** A1.1–A1.3 — System availability meets stated commitments.

**Audit checks:**
- SLA/SLO defined for system availability
- Capacity planning performed
- Environmental protections (redundancy, failover)
- Disaster recovery plan exists and tested
- Business continuity plan exists

**Required documents:**
- Business Continuity Plan
- Disaster Recovery Plan
- SLA/SLO Documentation
- Capacity Planning Report

---

## SOC2-08: Processing Integrity (PI1)

**Criteria:** PI1.1–PI1.5 — System processing is complete, accurate, timely, and authorized.

**Audit checks:**
- Input validation on all user-facing endpoints
- Output validation (data accuracy checks)
- Error handling doesn't expose sensitive data
- Processing is auditable (transaction logs)
- Data quality checks in place for critical operations

**Required documents:**
- Data Processing Procedures
- Input/Output Validation Standards
- Error Handling Policy

---

## SOC2-09: Confidentiality (C1)

**Criteria:** C1.1–C1.2 — Confidential information is protected as committed.

**Audit checks (beyond CC-10 Data Classification):**
- Confidentiality agreements (NDA) with employees and vendors
- Confidential data identified and tagged
- Disposal of confidential data verified (crypto-shred, secure delete)
- Access to confidential data restricted and logged

**Required documents:**
- Confidentiality Policy
- NDA Templates
- Data Disposal Procedures

---

## SOC2-10: Privacy (P1–P8)

**Criteria:** Personal information managed per privacy commitments.

**Audit checks:**
- Privacy notice/policy published and current
- Consent mechanisms for data collection
- Data collection limited to stated purposes
- Data subject rights supported (access, deletion, correction)
- Data retention schedule defined and enforced
- Third-party data sharing documented and authorized
- Privacy impact assessments for new features

**Required documents:**
- Privacy Policy
- Data Retention Schedule
- Data Subject Rights Procedures
- Privacy Impact Assessment Template

---

## SOC2 Report Structure

The final SOC2 report (prepared by auditor) contains:

1. **Section I** — Auditor's Report (opinion letter)
2. **Section II** — Management's Assertion
3. **Section III** — System Description *(we generate this)*
4. **Section IV** — Trust Service Criteria, Controls, and Tests *(we document controls)*
5. **Section V** — Other Information (optional)

The `implement` command generates Section III (System Description) and the control documentation that feeds into Section IV.

---

## Readiness Assessment Scoring

| Score | Meaning | Action |
|-------|---------|--------|
| 90-100% | Audit-ready | Schedule auditor engagement |
| 70-89% | Minor gaps | Address gaps (1-2 weeks), then schedule audit |
| 50-69% | Significant gaps | Remediation needed (1-2 months) |
| Below 50% | Major gaps | Full implementation required (3-6 months) |
