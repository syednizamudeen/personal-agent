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

## Planned: admin + tenant web portals (not yet built)

As of 2026-09-06 this app is API/curl-only — no frontend, no user accounts, no session-based auth exist anywhere in the codebase. The user has requested, and this is confirmed in-scope for upcoming work:

- A **super-admin portal**: full visibility/control across all tenants — view and edit any tenant's `MessageLog`s and `CorrectionRule`s, and broader platform administration (exact scope still being scoped out with the user as of this writing).
- **Per-tenant login/portal**: each tenant gets their own account to manage their own auto-replies, correction rules, and customizations — separate from the super-admin's cross-tenant view.
- A **UI-driven onboarding flow** to replace the current curl-only tenant-creation + QR-scanning flow, which the user found functional but not smooth.

This is being brainstormed (superpowers:brainstorming) as of 2026-09-06 — check for a design doc under `docs/superpowers/specs/` dated on or after that day before assuming it's undesigned or unstarted.

**Standing documentation requirement:** the user has explicitly asked that `README.md` and this `CLAUDE.md` be kept up to date whenever new features are built, now and in the future — not just at the end of a big task. Update both as part of implementing any feature, not as an afterthought.
