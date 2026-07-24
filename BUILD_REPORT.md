# Build report

## Included

- Dedicated `ABDM_MASTER` Express/MongoDB backend
- Existing MediQliq super-admin frontend API contract
- Facility, hospital, license, user and audit management
- HFR/HIP/HIU identity and connector onboarding
- Real bridge-service linkage checks; no forced sandbox success
- Per-facility encrypted connector secrets
- Canonical HMAC signing and replay protection
- M1 allow-listed ABHA proxy
- M2 HIP actions and asynchronous callbacks
- M3 HIU consent/data-request actions and asynchronous callbacks
- Expiring encrypted-data relay URLs for direct HIP-to-HIU delivery through the master
- Consent, transaction, webhook, job, HIU request and subscription metadata
- Retry/replay operations
- Callback JWT verification using OpenID discovery, JWKS rotation, issuer and optional audience/required-claim validation
- Dockerfile, environment template, API documentation and package lock

## Validation performed

- Repository-wide `node --check`: passed
- Static relative import validation: passed
- Six Node tests: passed
- Current master frontend route groups: present
- Hospital clinical routes: not mounted
- Secret-pattern scan: no supplied credentials found
- Package-lock consistency check: passed

## Environment limitation

A full `npm ci` download and live MongoDB/ABDM startup could not be completed in the build environment because package downloads were unavailable. Run `npm ci`, `npm run validate`, `npm test`, and a sandbox smoke test in local development or CI before deployment.

## Scope boundary

This is the central master/control-plane implementation. Hospital-side patient ownership, OTP rules, care contexts, FHIR generation/validation, consent enforcement, encryption/decryption, imported-record storage and clinical viewing remain hospital-backend responsibilities and are intentionally not duplicated here.
