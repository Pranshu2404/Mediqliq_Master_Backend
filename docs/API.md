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
