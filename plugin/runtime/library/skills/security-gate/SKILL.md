---
name: security-gate
description: >-
  Checks a change for security and privacy problems before it is deployed: secrets, authentication and access
  control, input handling, data exposure, dependencies and platform risks, with a pass or fail verdict and severities.
  Use before shipping anything that touches auth, payments, uploads, personal data, public endpoints, permissions or
  LLM tools.
worklings:
  kind: gate
  department: security
  from: security
  to: ops
---
# Security gate

Fail closed: a control you can't find in the code or confirm by running it doesn't count.

1. Scope the change: the diff against the base, what it touches (auth, payments, uploads, personal data, public
   endpoints, secrets, permissions, third-party code, LLM tools) and the data that flows through it.
2. Sketch the threat model in a few lines: who can reach this, with what input, what they could gain, and which trust
   boundaries the data crosses.
3. Check:
   - Secrets: none in code, config, logs, client bundles, test fixtures or the change's history.
   - Authentication and access: every new endpoint, action or message checks who is calling and whether they may
     touch that specific object; access is denied by default; sessions and tokens expire; cookies are `HttpOnly`,
     `Secure` and `SameSite`.
   - Input: validated at every boundary; no injection into SQL, shell commands, file paths, templates, HTML or an
     LLM's tools; uploads are checked for type and size and never served as code.
   - Output: responses, errors and logs reveal nothing they shouldn't; CORS is an allowlist; security headers and a
     CSP are set where the platform supports them.
   - Dependencies: new packages are needed, maintained and from the expected publisher; the audit shows no high or
     critical issues, or each one is explained.
   - Privacy: personal data is minimised, kept only as long as needed, deletable, and handled as the privacy policy
     and any consent say.
   - Platform: the risks named in `.claude/rules/` for this stack, such as extension permissions, desktop IPC, mobile
     secure storage, worker bindings or prompt injection.
   - Abuse: rate limits on sign-in and expensive endpoints; spending caps on paid APIs.
4. Run the security tools the project has (dependency audit, secret scan, static analysis) and record each command
   and result. Never probe production or third-party systems without the person's OK.
5. Bring in the studio's security and privacy reviewers for an independent read:

{{team}}

6. Verdict: **pass** or **fail**. Give each blocker a severity (critical, high, medium, low), the file and line, a
   one-sentence exploit scenario and the smallest fix. Suggestions go in a separate list.
