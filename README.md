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
- HMAC-authenticated shared FHIR validation, crypto and consent-validator façades for hospital backends

The master stores routing and consent metadata. It does not become the hospital clinical-record database. In the centralized deployment, FHIR/crypto/consent payloads may pass transiently through the Master façade to private services, but clinical payloads are not persisted in Master audit logs or as permanent hospital records.

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
- `POST /internal/abdm/shared/fhir/validate`
- `POST /internal/abdm/shared/crypto/receiver-key-material`
- `POST /internal/abdm/shared/crypto/encrypt`
- `POST /internal/abdm/shared/crypto/decrypt`
- `POST /internal/abdm/shared/consent/validate`
- `POST /internal/abdm/shared/consent/usage/:action`
- `POST /internal/abdm/shared/consent/status-events`
- Compatibility aliases remain available at `/proxy/abha`, `/hip/action`, and `/hiu/action`.

See `docs/API.md` for actions and callback routes.

## Important boundary

This repository implements the master-side orchestration and shared-compute surface. Hospital backends still own patient identity, OTP/registration policy, care contexts, clinical authorization decisions, FHIR **generation**, clinical storage and clinical viewing. The shared Master platform brokers private FHIR **validation**, certified crypto operations and cryptographic consent validation/usage enforcement. Official current ABDM contracts and certification requirements still apply end to end.
"# Mediqliq_Master_Backend" 


## Shared ABDM compute

FHIR validation, Fidelius-compatible cryptography and consent validation are owned by this Master repository under `apps/`. Hospital backends call the authenticated `/internal/abdm/shared/*` facade with their existing connector HMAC credentials; they do not address the private service containers directly. `docker-compose.abdm-services.yml` and `deployment/k8s/abdm-internal-services.yaml` are the private-service deployment definitions.

### Running the private shared services

From the Master backend repository, run `docker compose -f docker-compose.abdm-services.yml up -d --build`. The three compute services are not exposed on public interfaces. They are reachable either by Docker service name from a Master API container attached to `mediqliq-abdm-internal`, or through the compose file's `127.0.0.1` loopback bindings when the Master API runs directly on the host. Set the three Master service URLs in `.env` to match the selected deployment mode. Hospital backends must never be configured with these private service addresses; they call only the HMAC-authenticated Master `/internal/abdm/shared/*` routes.
