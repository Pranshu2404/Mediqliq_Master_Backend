# MediQliq ABDM Master Backend

Dedicated central ABDM bridge/control-plane backend extracted from the combined HIMS repository. It never mounts hospital patient, clinical, billing, pharmacy, or staff APIs.

## Responsibilities

- Existing MediQliq super-admin frontend API (`/api/mediqliq`)
- Facility/HFR/HIP/HIU onboarding and connector credentials
- ABDM gateway session management and bridge-service verification
- M1 ABHA API proxy for HMAC-authenticated hospital connectors
- M2 HIP outbound orchestration and public callback routing
- M3 HIU consent, health-information request, callback and encrypted-data relay orchestration
- Transactions, consent metadata, callbacks, jobs, retries and audit logs

The master stores routing and consent metadata. It should not become the hospital clinical-record database and does not decrypt imported health information.

## Setup

1. Copy `.env.example` to `.env` and insert rotated credentials. The requested MongoDB URI is read from `MONGO_URI`; no credential is embedded in this archive.
2. Install Node.js 20 or newer.
3. Run `npm ci`, `npm run validate`, `npm test`, then `npm start`.
4. Configure the current master frontend with `VITE_MEDIQLIQ_API_BASE_URL=http://localhost:5004/api/mediqliq`.

## Connector API

Hospital backends authenticate requests using the existing HMAC headers. Main endpoints:

- `POST /internal/abdm/m1/proxy`
- `POST /internal/abdm/m2/action`
- `POST /internal/abdm/m3/action`
- Compatibility aliases remain available at `/proxy/abha`, `/hip/action`, and `/hiu/action`.

See `docs/API.md` for actions and callback routes.

## Important boundary

This repository implements the master-side orchestration surface. Certification still requires the hospital backend to implement patient ownership, OTP controls, care contexts, consent enforcement, FHIR generation, encryption/decryption, clinical storage, and the official current Postman/test-case contracts.
"# Mediqliq_Master_Backend" 
