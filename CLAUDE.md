# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                    # install deps
npm test                       # run all Jest tests
npx jest tests/level2Engine.test.js -t "bypasses"   # run a single test by name
npm run dev                    # run server + workers locally with --watch (requires local Postgres/Redis/Ollama or port-forwarded ones)
npm run prisma:generate        # regenerate Prisma client after schema.prisma changes
npm run prisma:migrate         # create/apply a migration in dev
docker compose up -d --build   # start postgres, redis, ollama, and the app together (also auto-pulls the ollama model via the one-shot ollama-pull service; app waits on it)
docker compose exec app npx prisma migrate deploy  # apply migrations against the compose stack
```

There is no lint script configured.

## Architecture

This is a single Express process (`src/server.js`) that also boots two in-process BullMQ workers — there is no separate worker deployment by default; `startMessageWorker()` and `startReplyWorker()` run in the same Node process as the Admin API. Scale-out happens by running this same entry point in more containers, not by splitting workers into separate services.

**Sessions resume automatically on boot.** `server.js` calls `resumeActiveSessions()` (in `baileysManager.js`) on startup, which finds every `WhatsAppSession` row with status `CONNECTED` or `PENDING_QR` and calls `startSession()` for each. Since Baileys creds live in Redis independently of the in-process socket, a `CONNECTED` session reconnects with no QR scan; a `PENDING_QR` one just gets a fresh QR. Without this, restarting the app (a deploy, a crash, `docker compose restart`) would silently drop every live WhatsApp connection until someone manually re-called `POST /sessions` — this bit us once already in development.

**`connection.update` handler is defensive against deleted session rows.** If a `WhatsAppSession` row is deleted (e.g. its tenant is removed) while that tenant's socket is still live in memory, the handler's `prisma.whatsAppSession.update()` calls used to throw (Prisma `P2025`), and since this fires inside an event listener, the unhandled rejection crashed the whole Node process. Fixed by wrapping the handler in try/catch and switching to `updateMany` (which reports `count: 0` instead of throwing when the row is gone) — a `count === 0` on the `qr` or `close` branches now tears the socket down instead of looping forever. Keep this pattern if you touch that handler again: never let a per-tenant DB write crash the shared process.

**Horizontal scaling gotcha:** `baileysManager.js`'s `activeSockets` Map is in-process memory, not shared state. If you run more than one `app` replica, each tenant's live Baileys socket exists on exactly one instance (whichever handled that tenant's `POST /sessions` call) — `outgoing-replies-queue` jobs picked up by a *different* replica will find no socket via `getSocket(tenantId)` and silently no-op (see step 5 below). Scaling beyond a single instance requires either sticky per-tenant routing to the instance holding the socket, or moving session ownership out of process memory (e.g. a shared registry + inter-instance dispatch) — neither is implemented here.

**Multi-tenancy** is API-key based, not JWT/session based. Every route in `src/routes/api.js` except `POST /tenants` goes through `requireTenant` middleware, which resolves `Tenant` by the `x-api-key` header and attaches it as `req.tenant`. Controllers always scope Prisma queries by `req.tenant.id` — there is no cross-tenant query path, so any new endpoint must follow the same pattern.

**Message flow (the core pipeline to understand before changing behavior):**
1. `src/services/baileysManager.js` holds one Baileys socket per tenant in an in-memory `Map` (`activeSockets`), keyed by `tenantId`. Auth state is NOT stored on disk — it's persisted to Redis via `src/services/redisAuthState.js`, a custom implementation of Baileys' `AuthenticationState` interface (creds as a JSON blob, signal keys as a Redis hash), so sessions survive process restarts without local volumes.
2. Inbound messages are pulled off the `messages.upsert` socket event and enqueued onto `incoming-messages-queue` (`src/queues/messageQueue.js`) — the socket handler itself does no classification or DB writes beyond building the job payload, to avoid blocking the WhatsApp connection.
3. The `incoming-messages-queue` worker runs `src/services/level2Engine.js`: **Step A** checks the tenant's active `CorrectionRule` rows (`prisma.correctionRule.findMany`) for a regex/substring match — a match bypasses the LLM entirely (`source: 'RULE'`). **Step B**, only on no rule match, calls `src/services/ollamaClient.js` (`source: 'LLM'`), which POSTs to `${OLLAMA_BASE_URL}/api/generate` with `format: "json"` and a fixed system prompt, then parses the JSON response.
4. `src/services/replyGenerator.js` (`resolveOutcome`) turns the Level 2 result into one of three `MessageLog.status` values (`AUTO_REPLIED`, `FLAGGED_FOR_REVIEW`, `SKIPPED`) using a confidence threshold (`CONFIDENCE_THRESHOLD = 0.6`) and the rule's `action` enum (`SKIP_REPLY` / `FORCE_GREETING` / `FORCE_CATEGORY`). Every inbound message gets a `MessageLog` row regardless of outcome — this is the audit trail the admin review flow reads from.
5. Only `AUTO_REPLIED` outcomes enqueue a job on `outgoing-replies-queue` (`src/queues/replyQueue.js`). That worker looks up the tenant's live socket via `getSocket(tenantId)` from `baileysManager` (a job silently no-ops if the tenant has no active socket — e.g. after a restart before reconnect) and runs the fixed anti-ban sequence: mark-as-read → random 2-5s delay → `composing` presence → length-proportional typing delay (40-70ms/char + Gaussian jitter via Box-Muller) → send → `paused` presence.
6. Per-contact rate limiting happens in the `incoming-messages-queue` worker (`isRateLimited`), before the Level 2 engine even runs — it checks for any prior `AUTO_REPLIED` log for that `(tenantId, remoteJid)` within `Tenant.rateLimitHours`.

**Human-in-the-loop feedback loop:** `POST /api/v1/corrections` (`src/controllers/reviewController.js`) is how a `FLAGGED_FOR_REVIEW` message becomes a permanent `CorrectionRule` for that tenant, closing the loop back into Level 2 Step A for future messages. There is no automatic promotion from LLM output to rule — an admin (human) always creates the rule explicitly via this endpoint.

**Module load order / circular-require note:** `messageQueue.js` requires `replyQueue.js` requires `baileysManager.js`. `baileysManager.js` therefore requires `../queues/messageQueue` *lazily* (inside a function, see `getMessageQueue()`) rather than at top-level, to avoid a circular-require deadlock. Keep this lazy-require pattern if you add more cross-references between queues and `baileysManager.js`.

**Testing:** `tests/level2Engine.test.js` mocks `src/db/prisma` and `src/services/ollamaClient` directly (`jest.mock`) rather than hitting a real database or Ollama instance — no test DB/Redis/Ollama setup is required to run `npm test`.

**Dockerfile requires `openssl` installed explicitly** in all three stages. `node:24-slim` (Debian bookworm) ships without `libssl.so.1.1`/openssl CLI; without it Prisma can't detect the OpenSSL version and defaults to the wrong engine binary, crashing on boot with `libssl.so.1.1: cannot open shared object file`. Don't remove the `apt-get install -y openssl` lines when trimming the image.

**Ollama model pull is a one-shot Compose service, not a manual step.** `docker-compose.yml` has an `ollama-pull` service (`depends_on: ollama: condition: service_healthy`, `entrypoint: ["ollama", "pull", "${OLLAMA_MODEL:-gemma3:4b}"]`, `restart: "no"`) that runs once per `up` and exits; `app` depends on it via `condition: service_completed_successfully`. `ollama pull` is idempotent against the `ollama_data` volume, so this is fast after the first run. If you change the model, set `OLLAMA_MODEL` in `.env` before `docker compose up` — don't hardcode a different model name only in `app`'s environment, or `ollama-pull` will pull a different model than the app requests from Ollama.

**Migrations do not run automatically.** The container CMD is just `node src/server.js` — `prisma migrate deploy` must be run manually (`docker compose exec app npx prisma migrate deploy`) after first startup and after adding new migration files. There is no entrypoint script that does this on boot.

## Admin & tenant web portals

The original `x-api-key`-based API (`src/routes/api.js`, `requireTenant` middleware) is completely unchanged and still works for direct/programmatic access. Alongside it there are now two session-based portals, sharing one Express process:

- **Tenant portal** — `src/routes/portal.js`, mounted at `/api/v1/portal`. Login is by `Tenant.loginEmail`/`passwordHash` (new columns), not the API key.
- **Super-admin portal** — `src/routes/admin.js`, mounted at `/api/v1/admin`. `SuperAdmin` (`prisma/schema.prisma`) is a platform-wide account model, not tenant-scoped — it has no `Tenant` relation.
- Both are served to real users via a separate `web` Docker service (nginx + built SPA) on port 8080 that reverse-proxies `/api/*` to the `app` container's port 3000 — see `docker-compose.yml`. The `app` service's port 3000 is untouched and still answers direct curl calls.

**Dual auth, one process.** `express-session` + `connect-redis` (`src/config/session.js`, `createSessionMiddleware()`) backs both portals with cookie sessions stored in the same Redis instance BullMQ already uses. **`connect-redis` is pinned to `^6.1.3`, not v10** — v10 dropped support for the `ioredis` client this codebase already uses everywhere else (queues, `redisAuthState.js`) and only works with the official `redis` package. Introducing a second Redis client library just for sessions wasn't worth it, so the fix was staying on the v6 API (`new (require('connect-redis')(session))({ client, prefix })` — the "wrap `session`" v6 constructor shape, not v10's `new RedisStore({...})`). Don't bump this package without re-checking that constraint.

`src/middleware/requireTenantSession.js` and `src/middleware/requireSuperAdmin.js` read `req.session.tenantId`/`req.session.superAdminId`, load the row from Postgres, and attach `req.tenant`/`req.superAdmin` — the exact same shape the API-key middleware attaches. `requireTenantSession` also re-checks `tenant.status === 'ACTIVE'` on every request (not just at login), so suspending a tenant mid-session immediately locks them out.

**Portal routes reuse the existing api-key controllers — no parallel business logic.** `src/routes/portal.js` mounts `sessionController.createSession/listSessions/getSessionStatus/listMessageLogs` and `reviewController.listCorrections/createCorrection/deleteCorrection` directly, behind `requireTenantSession` instead of `requireTenant`. Both middlewares populate `req.tenant` identically, so these controllers didn't need to change at all. Only auth (`portalAuthController.js`) and session-reconnect are portal-specific code.

**Suspend, never delete.** `Tenant.status` (`ACTIVE` / `SUSPENDED`, set via `PATCH /admin/tenants/:id`) blocks portal login and blocks `requireTenantSession` on an already-logged-in session — but never deletes `MessageLog`/`CorrectionRule`/`WhatsAppSession` rows, and does not touch the tenant's live Baileys socket or API-key access (the original `x-api-key` routes don't check `status`). Suspension is a portal-login gate, not a kill switch — keep it that way rather than reusing this flag for anything destructive.

**Disconnect notification + reconnect.** `baileysManager.js` emails the tenant once (`sendDisconnectAlertEmail`, `src/services/emailService.js`) when a session's connection hits `LOGGED_OUT`, gated by `WhatsAppSession.disconnectNotifiedAt` so a flapping connection doesn't spam — it's cleared back to `null` on a successful reconnect so the *next* disconnect alerts again. `reconnectSession(tenantId, sessionId)` (`baileysManager.js`) flips the existing session row back to `PENDING_QR` and starts a fresh Baileys socket for it, rather than creating a new `WhatsAppSession` row — both `POST /portal/sessions/:sessionId/reconnect` and `POST /admin/tenants/:id/sessions/:sessionId/reconnect` call this same function.

**Email is best-effort, not required infra.** `src/services/emailService.js` is plain SMTP via `nodemailer` (no vendor SDK). If `SMTP_HOST` etc. are unset, it logs a warning and skips sending instead of throwing — password-reset and disconnect-alert code paths never crash because email isn't configured. Don't add a hard dependency on email delivery succeeding.

**Audit log: one row per state-changing action.** `src/services/auditService.js`'s `writeAuditLog({ actorType, actorId, action, targetType, targetId, tenantId, beforeData, afterData })` is called from every admin/portal route that mutates something (tenant create/update/suspend, password resets, corrections, session reconnects, super-admin creation). `beforeData`/`afterData` are partial snapshots of just the changed fields, not full-row dumps — follow that convention (see `adminTenantController.js`'s `updateTenant` for the pattern) rather than logging entire rows.

**First super-admin is a manual, one-time step — never auto-seeded.** `node scripts/create-super-admin.js --email=... --password=... [--name=...]` (`npm run create-admin --`). There's no bootstrap-on-boot logic; running it twice for the same email exits with an error instead of creating a duplicate.

**Frontend (`web/`): Vite + React 19 + TypeScript + Tailwind CSS v4 + react-router-dom v7 + TanStack Query v5.** One SPA build, two route trees (`/portal/*`, `/admin/*`), each with its own auth context (`web/src/lib/authContext.tsx`: `usePortalAuth`/`useAdminAuth`) that polls its own `/me` endpoint to establish logged-in state — there's no shared auth context between the two portals even though they share a codebase and a session cookie mechanism. **Tailwind v4 requires an explicit `@config "../tailwind.config.js";` directive in `web/src/index.css`** — unlike v3, it does not auto-discover a JS config file; omitting that line silently falls back to default theme tokens with no build error, so if the "Dark Ops Console" theme ever looks unstyled/default, check that directive first.

**Known gap: `Tenant.loginEmail` currently has no write path.** Neither `POST /admin/tenants` (`adminTenantController.js` `createTenant` — only reads `name`/`rateLimitHours` off `req.body`) nor `PATCH /admin/tenants/:id` (`updateTenant` — only reads `name`/`rateLimitHours`/`status`) accepts `loginEmail`, and there's no other endpoint that sets it. `POST /admin/tenants/:id/send-password-reset` requires `tenant.loginEmail` to already be set and returns 400 otherwise. In practice, today, a new tenant's `loginEmail` has to be set directly against Postgres (e.g. `UPDATE tenants SET "loginEmail" = '...' WHERE id = '...'`, or via `prisma studio`) before the reset-password flow can hand them portal access. This wasn't caught before merge; treat "add `loginEmail` to one of the admin tenant endpoints" as an obvious near-term follow-up rather than something already covered.

**Known gap: unhandled-rejection risk in newer async routes.** `src/services/baileysManager.js`'s `connection.update` handler already hit this in production once (see above) and was fixed with try/catch + `updateMany`. Several of the newer portal/admin async Express handlers (e.g. `POST /admin/super-admins` on a duplicate email) don't wrap their Prisma calls in try/catch, so a DB error mid-request becomes an unhandled promise rejection instead of a clean 500. Not fixed route-by-route here; the better fix is a shared `asyncHandler` wrapper applied across all Express routes in one pass.

**Standing documentation requirement:** the user has explicitly asked that `README.md` and this `CLAUDE.md` be kept up to date whenever new features are built, now and in the future — not just at the end of a big task. Update both as part of implementing any feature, not as an afterthought.
