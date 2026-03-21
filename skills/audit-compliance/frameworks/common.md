# Common Compliance Controls

Shared controls that apply across SOC2, HIPAA, and most regulatory frameworks. Each control has a unique ID for cross-referencing.

---

## CC-01: Encryption at Rest

**Requirement:** All sensitive data must be encrypted at rest using AES-256 or equivalent.

**Audit checks:**
- Database encryption enabled (SQLite: SQLCipher or encrypted volume; PostgreSQL: TDE or pgcrypto; MySQL: TDE)
- File storage encryption (S3: SSE-S3/SSE-KMS, local: LUKS/FileVault/BitLocker)
- Backup encryption enabled
- No plaintext credentials in config files, environment dumps, or code

**Implementation:**
- Enable database-level encryption or use encrypted storage volumes
- Configure cloud storage with server-side encryption
- Rotate encryption keys annually
- Document encryption standards in Information Security Policy

**Evidence artifacts:**
- Screenshot/config showing encryption enabled
- Key management documentation
- Encryption policy document

---

## CC-02: Encryption in Transit

**Requirement:** All data in transit must use TLS 1.2+ or equivalent.

**Audit checks:**
- HTTPS enforced on all endpoints (no HTTP fallback without redirect)
- TLS 1.2+ minimum (no SSLv3, TLS 1.0, TLS 1.1)
- Valid SSL certificates (not expired, not self-signed in production)
- Internal service-to-service communication encrypted
- Database connections use SSL/TLS

**Implementation:**
- Configure TLS 1.2 minimum on all web servers and load balancers
- Set HSTS headers (`Strict-Transport-Security`)
- Use certificate automation (Let's Encrypt / ACM)
- Enforce SSL on database connections

**Evidence artifacts:**
- SSL Labs scan results
- Server configuration showing TLS minimum version
- HSTS header verification

---

## CC-03: Authentication Controls

**Requirement:** Strong authentication for all user and system access.

**Audit checks:**
- Password policy enforced (minimum 12 characters, complexity requirements)
- Multi-factor authentication (MFA) available and enforced for admin accounts
- Session management (timeout, secure cookies, httpOnly, sameSite)
- API authentication (API keys, OAuth, JWT — not basic auth in production)
- Service account credentials rotated on schedule
- No shared accounts or default passwords

**Implementation:**
- Implement password policy with minimum 12 chars, complexity rules
- Enable MFA for all privileged accounts
- Configure session timeout (15-30 min idle, 8-12 hr max)
- Use httpOnly, secure, sameSite cookies
- Implement API key rotation mechanism

**Evidence artifacts:**
- Authentication policy document
- MFA enrollment report
- Session configuration evidence

---

## CC-04: Access Control

**Requirement:** Role-based access control (RBAC) with least privilege.

**Audit checks:**
- RBAC implemented (not just admin/user — granular roles)
- Least privilege enforced (users only have access they need)
- Access reviews conducted quarterly
- Privilege escalation requires approval
- Separation of duties for critical operations
- Terminated user access revoked within 24 hours

**Implementation:**
- Define role hierarchy with specific permissions
- Implement RBAC middleware/guards
- Create access review process (quarterly)
- Document onboarding/offboarding procedures
- Implement break-glass emergency access with audit trail

**Evidence artifacts:**
- RBAC matrix document
- Access review logs
- Onboarding/offboarding checklist

---

## CC-05: Audit Logging

**Requirement:** Comprehensive, tamper-evident logging of security-relevant events.

**Audit checks:**
- Authentication events logged (login, logout, failed attempts, MFA)
- Authorization events logged (access granted, denied, privilege changes)
- Data access logged (reads/writes to sensitive data)
- System changes logged (config changes, deployments, user management)
- Logs include: timestamp, actor, action, resource, outcome, source IP
- Logs stored securely (immutable/append-only, encrypted)
- Log retention meets framework requirements (1 year SOC2, 6 years HIPAA)

**Implementation:**
- Implement structured logging (JSON format)
- Include required fields in every log entry
- Ship logs to centralized, immutable storage
- Set retention policies per framework
- Alert on suspicious patterns (brute force, privilege escalation)

**Evidence artifacts:**
- Sample log entries showing required fields
- Log retention configuration
- Alerting rules documentation

---

## CC-06: Incident Response

**Requirement:** Documented and tested incident response plan.

**Audit checks:**
- Incident response plan exists and is current (<12 months old)
- Plan defines: roles, severity levels, communication channels, escalation paths
- Breach notification procedures documented (who, when, how)
- Plan has been tested (tabletop exercise or actual incident) in past 12 months
- Post-incident review process defined

**Implementation:**
- Write Incident Response Plan with:
  - Incident classification (P0-P4)
  - Response team roles and contact info
  - Communication templates (internal, external, regulatory)
  - Escalation matrix
  - Evidence preservation procedures
- Schedule annual tabletop exercise
- Create post-incident review template

**Evidence artifacts:**
- Incident Response Plan document
- Tabletop exercise records
- Post-incident review reports

---

## CC-07: Change Management

**Requirement:** Controlled, documented process for system changes.

**Audit checks:**
- Changes go through review process (PR reviews, approval gates)
- Testing required before deployment (CI/CD with tests)
- Rollback procedures documented
- Emergency change process defined
- Change log maintained

**Implementation:**
- Require PR reviews for all code changes
- Implement CI/CD pipeline with automated tests
- Document deployment and rollback procedures
- Create change advisory board (CAB) process for significant changes
- Maintain change log (git history + release notes)

**Evidence artifacts:**
- PR review policy/branch protection rules
- CI/CD pipeline configuration
- Recent PR examples showing review process

---

## CC-08: Vulnerability Management

**Requirement:** Regular identification and remediation of vulnerabilities.

**Audit checks:**
- Dependency scanning (npm audit, pip audit, etc.)
- Container image scanning
- Static analysis (SAST) in CI/CD
- Known vulnerabilities remediated within SLA (critical: 48h, high: 7d, medium: 30d)
- Penetration testing conducted annually

**Implementation:**
- Enable Dependabot/Snyk/npm audit in CI
- Add SAST tool to pipeline (CodeQL, Semgrep)
- Define vulnerability SLAs by severity
- Schedule annual penetration test
- Create vulnerability management policy

**Evidence artifacts:**
- Dependency scan results
- Vulnerability remediation tickets/timeline
- Penetration test report

---

## CC-09: Data Backup & Recovery

**Requirement:** Regular backups with tested recovery procedures.

**Audit checks:**
- Automated backups configured (daily minimum)
- Backups encrypted
- Backups stored in separate location (different region/provider)
- Recovery tested at least annually
- Recovery Time Objective (RTO) and Recovery Point Objective (RPO) defined

**Implementation:**
- Configure automated daily backups
- Enable backup encryption
- Set up cross-region backup replication
- Document RTO/RPO targets
- Schedule annual recovery test
- Create backup monitoring alerts

**Evidence artifacts:**
- Backup configuration
- Recovery test results
- RTO/RPO documentation

---

## CC-10: Data Classification & Handling

**Requirement:** Data classified by sensitivity with appropriate handling procedures.

**Audit checks:**
- Data classification scheme defined (Public, Internal, Confidential, Restricted)
- Sensitive data identified and inventoried
- Handling procedures per classification level
- Data disposal procedures (secure deletion, media destruction)
- No sensitive data in logs, error messages, or debug output

**Implementation:**
- Create Data Classification Policy
- Inventory all data stores and classify contents
- Implement data handling procedures per level
- Configure log sanitization (mask/redact sensitive fields)
- Create data disposal procedures

**Evidence artifacts:**
- Data Classification Policy
- Data inventory/map
- Log sanitization evidence
