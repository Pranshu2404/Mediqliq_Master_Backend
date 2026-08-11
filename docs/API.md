# Master API surface

## Super-admin frontend
All existing endpoints under `/api/mediqliq` are preserved, including authentication, dashboard, users, hospitals, licenses, audit logs, facilities, gateway, consents, jobs, transactions and webhooks. Added operations:

- `POST /api/mediqliq/abdm/jobs/:jobId/retry`
- `POST /api/mediqliq/abdm/webhook-events/:eventId/replay` (requires callback payload retention)

## M1 connector
`POST /internal/abdm/m1/proxy` accepts `{ method, path, body, headers, responseType }` and forwards only allow-listed ABHA operations. Hospital-side patient/session ownership remains mandatory.

## M2 connector actions
`GENERATE_LINK_TOKEN`, `LINK_CARE_CONTEXT`, `NOTIFY_CARE_CONTEXT_UPDATE`, `RESPOND_DISCOVERY`, `RESPOND_LINK_INIT`, `RESPOND_LINK_CONFIRM`, `ACK_CONSENT`, `ACK_HEALTH_INFORMATION`, `NOTIFY_HEALTH_INFORMATION`, `ACK_PROFILE_SHARE`.

## M3 connector actions
`INIT_CONSENT_REQUEST`, `GET_CONSENT_STATUS`, `FETCH_CONSENT`, `ACK_CONSENT_NOTIFY`, `REQUEST_HEALTH_INFORMATION`, `NOTIFY_HEALTH_INFORMATION`. Before `REQUEST_HEALTH_INFORMATION`, the hospital can call `POST /internal/abdm/m3/data-relay-token` to obtain an expiring master relay URL while retaining the private decryption key locally. Subscription actions are present behind `ABDM_ENABLE_SUBSCRIPTIONS=true`.

## Public callbacks
M2 routes from the original code are retained. M3 routes include:

- `/api/v3/hiu/consent/request/on-init`
- `/api/v3/hiu/consent/request/notify`
- `/api/v3/hiu/consent/request/on-status`
- `/api/v3/hiu/consent/on-fetch`
- `/api/v3/hiu/health-information/on-request`
- `/api/v3/hiu/health-information/data` and `/api/v3/hiu/data`

Aliases are included for inconsistent hyphenation seen in supplied specifications. Before certification, reconcile paths and payloads with the assigned current ABDM V3 Postman collection.

## Shared ABDM compute (hospital connector authentication required)

All routes below inherit the same `X-MediQliq-*` HMAC connector authentication as M1/M2/M3. Tenant/facility identity is resolved from the authenticated `AbdmFacility`; payload fields never choose the tenant.

- `GET /internal/abdm/shared/health`
- `POST /internal/abdm/shared/fhir/validate` — forwards the validator request body to the private NRCeS/HAPI validator.
- `POST /internal/abdm/shared/crypto/receiver-key-material`
- `POST /internal/abdm/shared/crypto/encrypt`
- `POST /internal/abdm/shared/crypto/decrypt`
- `POST /internal/abdm/shared/consent/validate`
- `POST /internal/abdm/shared/consent/usage/commit` with `{ "reservationId": "..." }`
- `POST /internal/abdm/shared/consent/usage/release` with `{ "reservationId": "..." }`
- `POST /internal/abdm/shared/consent/status-events`

The Master forwards server-generated tenant/facility headers to private services and never includes clinical/FHIR request bodies in its shared-service audit records. Consent usage reservation IDs are mapped to the authenticated tenant before commit/release is permitted.

## Super-admin shared service monitoring

- `GET /api/mediqliq/abdm/shared-services/health` — super-admin-only PHI-free health summary for the Master-hosted FHIR, crypto and consent services. It returns readiness metadata only and never returns service tokens, private URLs or clinical request bodies.
