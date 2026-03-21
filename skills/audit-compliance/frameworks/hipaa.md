# HIPAA Framework — Security, Privacy & Breach Notification Rules

Framework-specific controls beyond the common controls in `common.md`.
Maps to 45 CFR Parts 160, 162, and 164.

---

## Shared Controls (from common.md)

These common controls satisfy the following HIPAA requirements:

| Common Control | HIPAA Section |
|---------------|--------------|
| CC-01 Encryption at Rest | 164.312(a)(2)(iv), 164.312(e)(2)(ii) |
| CC-02 Encryption in Transit | 164.312(e)(1), 164.312(e)(2)(i) |
| CC-03 Authentication | 164.312(d) |
| CC-04 Access Control | 164.312(a)(1) |
| CC-05 Audit Logging | 164.312(b) |
| CC-06 Incident Response | 164.308(a)(6), 164.414 |
| CC-07 Change Management | 164.308(a)(8) |
| CC-08 Vulnerability Management | 164.308(a)(1)(ii)(B) |
| CC-09 Backup & Recovery | 164.308(a)(7), 164.310(d)(2)(iv) |
| CC-10 Data Classification | 164.308(a)(1)(ii)(A) |

---

## HIPAA-01: Security Risk Assessment (164.308(a)(1))

**THE most important HIPAA requirement. This is what OCR asks for first.**

**Requirement:** Conduct an accurate and thorough assessment of potential risks and vulnerabilities to the confidentiality, integrity, and availability of ePHI.

**Audit checks:**
- SRA completed within past 12 months
- All ePHI repositories identified (databases, files, backups, logs, emails)
- Threat sources identified (external, internal, environmental)
- Vulnerability assessment performed for each ePHI system
- Risk levels assigned (likelihood x impact)
- Remediation plan with timelines for each identified risk
- SRA reviewed and approved by management

**Required documents:**
- Security Risk Assessment Report (use `templates/sra-template.md`)
- ePHI Inventory
- Risk Register with Treatment Plans

**Penalties for non-compliance:** $100-$50,000 per violation, up to $1.5M/year per category. OCR has levied multi-million dollar fines specifically for failure to conduct an SRA.

---

## HIPAA-02: PHI Data Flow Mapping (164.308(a)(1)(ii)(A))

**Requirement:** Identify all locations where PHI is created, received, maintained, or transmitted.

**Audit checks:**
- PHI data flow diagram exists and is current
- All systems that touch PHI identified (apps, databases, APIs, third parties)
- All transmission paths mapped (API calls, file transfers, emails)
- All storage locations identified (databases, file systems, backups, logs)
- PHI in logs identified and redacted/minimized
- PHI in error messages/stack traces eliminated

**Code-level checks:**
- Search for PHI field names in code (name, DOB, SSN, MRN, diagnosis, insurance)
- Verify PHI fields are not logged in plaintext
- Verify PHI is not included in error responses
- Verify PHI is not stored in browser localStorage/sessionStorage
- Check for PHI in URL parameters (violation — use POST bodies instead)

**Required documents:**
- PHI Data Flow Diagram
- PHI Inventory (systems, fields, classification)

---

## HIPAA-03: Minimum Necessary Standard (164.502(b))

**Requirement:** Limit PHI access and disclosure to the minimum necessary to accomplish the intended purpose.

**Audit checks:**
- API endpoints return only necessary PHI fields (not entire records)
- Database queries select specific columns (not SELECT *)
- Role-based access limits PHI visibility by role
- Reports and exports include only necessary PHI
- De-identification procedures available (Safe Harbor or Expert Determination)

**Code-level checks:**
- Review API responses for excess PHI fields
- Check database queries for unnecessary PHI column selection
- Verify UI components only display PHI needed for the user's role

**Required documents:**
- Minimum Necessary Policy
- PHI Access Matrix (role → allowed PHI fields)

---

## HIPAA-04: Business Associate Agreements (164.308(b), 164.502(e))

**Requirement:** Written agreements with all entities that create, receive, maintain, or transmit PHI on your behalf.

**Audit checks:**
- All business associates identified (cloud providers, SaaS tools, consultants)
- BAA signed with each business associate
- BAAs include required provisions (permitted uses, safeguards, breach notification, termination)
- BAA inventory maintained and reviewed annually
- Sub-business associate chain documented

**Common business associates to check:**
- Cloud provider (AWS, GCP, Azure) — must have BAA
- Database hosting — must have BAA
- Email provider (if PHI in email) — must have BAA
- Analytics tools — must NOT receive PHI, or need BAA
- Logging/monitoring services — must have BAA if they see PHI
- Payment processors — typically not BA unless they see PHI

**Required documents:**
- Business Associate Agreement template
- Business Associate Inventory
- Annual BAA Review Log

---

## HIPAA-05: Workforce Training (164.308(a)(5))

**Requirement:** Security awareness and training program for all workforce members.

**Audit checks:**
- Training program exists covering HIPAA basics, PHI handling, incident reporting
- All workforce members complete training upon hiring
- Annual refresher training conducted
- Training completion tracked and documented
- Training updated when policies change
- Sanctions policy for violations exists and is communicated

**Required documents:**
- HIPAA Training Materials
- Training Completion Records
- Sanctions Policy

---

## HIPAA-06: Access Management (164.308(a)(3), 164.308(a)(4))

**Requirement:** Authorize and supervise workforce members who work with ePHI. Implement procedures for access establishment and modification.

**Audit checks (beyond CC-04):**
- Unique user identification for all users (164.312(a)(2)(i))
- Emergency access procedure (break-glass) (164.312(a)(2)(ii))
- Automatic logoff after inactivity (164.312(a)(2)(iii))
- Access authorization based on role/function
- Access modification on role change
- Access termination within 24 hours of employment end
- Access reviews conducted (recommended quarterly)

**Required documents:**
- Workforce Access Authorization Procedures
- Termination Procedures
- Emergency Access Procedure

---

## HIPAA-07: Breach Notification (164.400-414)

**Requirement:** Notify affected individuals, HHS, and potentially media following a breach of unsecured PHI.

**Audit checks:**
- Breach assessment procedure defined (4-factor risk assessment)
- Notification timelines known and documented:
  - Individual notice: within 60 days of discovery
  - HHS notice: within 60 days (if 500+), annual (if <500)
  - Media notice: within 60 days (if 500+ in a state/jurisdiction)
- Breach log maintained
- Notification templates prepared

**4-factor risk assessment (per HHS guidance):**
1. Nature and extent of PHI involved
2. Unauthorized person who used/accessed PHI
3. Whether PHI was actually acquired or viewed
4. Extent to which risk has been mitigated

**Required documents:**
- Breach Notification Policy & Procedures
- Breach Risk Assessment Template
- Notification Letter Templates (individual, HHS, media)
- Breach Log

---

## HIPAA-08: Physical Safeguards (164.310)

**Requirement:** Physical measures to protect ePHI systems and facilities.

**Audit checks:**
- Facility access controls (locks, badges, visitor logs)
- Workstation use policy (screen locks, clean desk)
- Workstation security (encryption, remote wipe capability)
- Device and media controls (disposal, re-use, movement tracking)
- Server room / data center physical security

**Note:** Most physical safeguards cannot be audited via code scanning. The audit script flags these for **manual review** and generates a checklist.

**Required documents:**
- Facility Security Plan
- Workstation Use Policy
- Device & Media Controls Policy

---

## HIPAA-09: Integrity Controls (164.312(c))

**Requirement:** Protect ePHI from improper alteration or destruction.

**Audit checks:**
- Database integrity checks (checksums, constraints)
- Input validation on all PHI fields
- Audit trail for PHI modifications (who changed what, when)
- Version history / soft deletes for PHI records
- Backup integrity verification

**Code-level checks:**
- Database constraints on PHI fields (NOT NULL, CHECK, FK)
- Input validation for PHI data types (date format, SSN format)
- Audit columns on PHI tables (created_at, updated_at, updated_by)

**Required documents:**
- Data Integrity Policy
- PHI Modification Audit Procedures

---

## HIPAA-10: Contingency Planning (164.308(a)(7))

**Requirement:** Establish procedures for responding to emergencies or system failures.

**Audit checks (beyond CC-09):**
- Data backup plan documented and tested
- Disaster recovery plan documented and tested
- Emergency mode operation plan (how to operate during outage)
- Testing and revision procedure (annual minimum)
- Criticality analysis (which systems are essential for PHI access)

**Required documents:**
- Contingency Plan (umbrella document)
- Data Backup Plan
- Disaster Recovery Plan
- Emergency Mode Operations Plan
- Testing & Revision Schedule

---

## HIPAA Penalty Structure

| Tier | Knowledge Level | Per Violation | Annual Maximum |
|------|----------------|---------------|----------------|
| 1 | Did not know | $100-$50,000 | $25,000 |
| 2 | Reasonable cause | $1,000-$50,000 | $100,000 |
| 3 | Willful neglect (corrected) | $10,000-$50,000 | $250,000 |
| 4 | Willful neglect (not corrected) | $50,000 | $1,500,000 |

Criminal penalties: up to $250,000 and 10 years imprisonment for wrongful disclosure with intent to sell.

---

## Readiness Assessment Scoring

| Score | Meaning | Action |
|-------|---------|--------|
| 90-100% | Compliant | Maintain with monitoring |
| 70-89% | Minor gaps | Address within 30 days |
| 50-69% | Significant gaps | Remediation plan needed (60-90 days) |
| Below 50% | Major non-compliance | Immediate action required — high risk of penalties |
