# Serverless Concert Ticket Booking Platform (Azure)

## Status (honest summary)

| Area                                                             | Status                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core domain (`packages/core`)                                    | Done. 11 unit tests + invariant script pass                                                                                                                                                                                                                                                                       |
| Cosmos DB (Terraform, 3 containers, free tier)                   | Deployed; API verified against it                                                                                                                                                                                                                                                                                 |
| Azure Service Bus (Basic tier, queue `booking-requests`)         | Deployed via Terraform. Verified: booking goes `QUEUED` to `CONFIRMED` through a queue-triggered function running locally                                                                                                                                                                                         |
| Azure Functions API (v4, Node 20)                                | Runs **locally** against real Cosmos and Service Bus. Not deployed to Azure                                                                                                                                                                                                                                       |
| React + Vite frontend (`apps/web`)                               | Works locally (concerts, seats, booking, status, my bookings)                                                                                                                                                                                                                                                     |
| Budget alert                                                     | $5 monthly subscription budget (Terraform, emails at 50/80/100% and forecast)                                                                                                                                                                                                                                     |
| Authentication                                                   | **Demo-grade, local only.** Login page with passwords for `alice`, `bob` (customers) and `admin`; API issues signed 8-hour tokens, 5 failed attempts lock an account for 1 minute. Passwords come from the Git-ignored `local.settings.json`. Not Microsoft Entra; endpoints return 403 outside local development |
| Admin dashboard                                                  | Admin sees system overview, all bookings from all users, and an in-memory activity log (cleared on API restart, not a durable audit trail). Routes: `/api/console/*`                                                                                                                                              |
| Service Bus topic / event publishing, notification email (ACS)   | **Out of scope** (Basic tier has no topics)                                                                                                                                                                                                                                                                       |
| Dead-letter handling                                             | Queue dead-letters after 5 failed deliveries (configured, **not tested**)                                                                                                                                                                                                                                         |
| APIM, Static Web Apps, Functions deployment, App Insights, CI/CD | **Not deployed / not built**                                                                                                                                                                                                                                                                                      |
| k6 load test                                                     | Not run                                                                                                                                                                                                                                                                                                           |

> Without `SERVICEBUS_NAMESPACE` the API uses an in-memory queue and the dev-only processor
> (`/api/dev/process-booking`, returns 403 outside local development). Booking endpoints return 403
> outside local development because there is no real authentication yet.

## Run locally

```bash
npm install
cp apps/api/local.settings.sample.json apps/api/local.settings.json
# add COSMOS_ENDPOINT, COSMOS_DATABASE=ticketing, and optionally
# SERVICEBUS_NAMESPACE and ServiceBusConnection__fullyQualifiedNamespace (hostnames, no keys),
# DEMO_PASSWORD_ALICE / _BOB / _ADMIN and AUTH_SIGNING_SECRET (16+ random chars); then `az login`
npm run build --workspace=@tix/api
(cd apps/api && func start)           # port 7071
npm run dev --workspace=@tix/web      # http://localhost:5173 (proxies /api)
```

Service Bus uses Microsoft Entra credentials (`DefaultAzureCredential`); local key auth is disabled.

## Verification

```bash
npm run typecheck && npm test && npm run verify:invariants && npm run lint
npm run build
```

Last run: typecheck, lint, 11/11 tests, invariants and all builds passed.

## Booking semantics

- Booking ID: `bk_` + first 32 hex of SHA-256(`userId:idempotencyKey`).
- Same key + payload returns 200 with the existing booking; different payload returns 422.
- Seat claims are conditional and all-or-nothing; a losing booking ends `FAILED` (`SEAT_UNAVAILABLE`).
- A user may hold at most 4 seats per event (`SEAT_LIMIT_EXCEEDED`).
- A competing request is accepted as `QUEUED` and fails at processing time.
- Bob cannot read Alice's bookings (404); customers get 403 on admin routes; admin cannot book.
- If the queue is unavailable, submission returns a retryable 503 (never `QUEUED`); the booking record stays un-enqueued and a retry with the same key re-sends it. Such records count toward the per-user seat limit until cleaned.

## Cost

Cosmos DB free tier, Service Bus Basic (pay per operation), $5 budget alert. Nothing else is deployed.

## Cleanup

`terraform destroy -var-file=dev.tfvars` in `infra/envs/dev` removes only this project's
resources. Do not touch other lab resource groups.
