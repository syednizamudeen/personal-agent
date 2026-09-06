# personal-agent

Multi-tenant WhatsApp automation service: Baileys session management, BullMQ
queues for async message processing, a Level 2 human-in-the-loop rule engine,
and Ollama-powered vision/text classification with humanized, anti-ban replies.

## Architecture

- **Admin API** (`src/server.js` + `src/routes/api.js`) — tenant onboarding, QR
  session provisioning, message log review, correction rule management.
- **Session manager** (`src/services/baileysManager.js`) — one Baileys socket
  per tenant, auth state persisted in Redis (`src/services/redisAuthState.js`)
  so sessions survive restarts.
- **`incoming-messages-queue`** (`src/queues/messageQueue.js`) — runs the
  Level 2 engine (`src/services/level2Engine.js`) per message: hard
  `CorrectionRule` match first, Ollama vision/text classification
  (`src/services/ollamaClient.js`) as fallback.
- **`outgoing-replies-queue`** (`src/queues/replyQueue.js`) — read receipt,
  randomized delay, "composing" presence, length-proportional typing delay
  with Gaussian jitter, then send.

## Prerequisites

- Docker + Docker Compose
- ~4-8GB free RAM/VRAM for the Ollama model

## Setup

1. Copy env file:

   ```bash
   cp .env.example .env
   ```

2. Start infra + app:

   ```bash
   docker compose up -d --build
   ```

   This also pulls the Ollama model automatically the first time — see
   [How the model gets pulled](#how-the-model-gets-pulled) below. The `app`
   container won't start until that pull finishes, so first boot can take a
   few minutes depending on your connection (~3GB download for `gemma3:4b`).

3. Run database migrations:

   ```bash
   docker compose exec app npx prisma migrate deploy
   ```

   (For local dev without Docker: `npm install && npm run prisma:migrate`.)

4. Confirm everything's up:

   ```bash
   docker compose ps
   curl http://localhost:3000/health
   ```

   `docker compose ps` should show `postgres`, `redis`, `ollama`, and `app` all
   running/healthy; `/health` should return `{"ok":true}`.

## Docker command reference

| Command | When to run it | What it does |
|---|---|---|
| `docker compose up -d --build` | First-time setup, or after any code/Dockerfile change | Builds the app image and (re)starts all 4 containers. Safe to re-run any time — existing volumes are reused, not wiped. |
| `docker compose up -d` | After a `.env`/`docker-compose.yml` config change, no code change | Recreates containers with new config without rebuilding the image. |
| `docker compose ps` | Any time, to check status | Lists containers and their health. |
| `docker compose logs -f app` | While testing, to watch what the pipeline is doing | Tails the app's logs live (`Ctrl+C` to stop tailing — containers keep running). |
| `docker compose exec app npx prisma migrate deploy` | After first startup, and after pulling any new migration files | Applies pending DB migrations. **Not automatic** — nothing runs this on container boot. |
| `docker compose exec ollama ollama pull <model>` | Only if you need to manually re-trigger a pull (e.g. debugging) | The `ollama-pull` service normally handles this automatically on every `up` — see below. |
| `docker compose stop` | Pausing work for the day | Stops all containers, keeps everything (volumes, containers, network) intact. |
| `docker compose start` | Resuming after `stop` | Restarts the same containers where they left off. |
| `docker compose restart app` | App misbehaving but infra is fine | Restarts just the app container, no rebuild. |
| `docker compose down` | Tearing down for the session, or before a `docker-compose.yml` structural change (renamed service, etc.) | Removes containers + network. **Volumes are untouched** — data survives. |

### How the model gets pulled

The official `ollama/ollama` image ships with no models baked in (they're
multi-gigabyte, so bundling one would bloat every pull of the base image).
Instead, `docker-compose.yml` defines a one-shot `ollama-pull` service:

```yaml
ollama-pull:
  image: ollama/ollama:latest
  depends_on:
    ollama:
      condition: service_healthy
  entrypoint: ["ollama", "pull", "${OLLAMA_MODEL:-gemma3:4b}"]
  restart: "no"
```

It waits for the `ollama` server to pass its healthcheck, runs `ollama pull`
once, and exits. `app` depends on `ollama-pull` completing successfully
before it starts. The model lands in the `ollama_data` volume, so on every
`docker compose up` after the first, the pull step just verifies the model is
already present and exits in a couple of seconds — it does not re-download.
To use a different model, set `OLLAMA_MODEL` in `.env` before running `up`.

### ⚠️ Do NOT run these unless you intend to permanently delete all data

```bash
docker compose down -v          # DESTROYS postgres/redis/ollama volumes — all tenants, sessions, message logs, the pulled model
docker volume rm personal-agent_postgres_data   # (or any of the three volumes) — same effect, one volume at a time
docker system prune --volumes   # wipes volumes across your ENTIRE Docker installation, not just this project
```

Only reach for these deliberately (e.g. resetting to a clean slate in dev). There is no confirmation prompt on `-v` — it deletes immediately.

## Data persistence

Postgres, Redis, and the pulled Ollama model are stored in named Docker
volumes (`personal-agent_postgres_data`, `personal-agent_redis_data`,
`personal-agent_ollama_data`), not inside the containers themselves — they
survive `docker compose stop/start`, `restart`, and `up -d --build` (rebuilding
the image does not touch the volumes). WhatsApp session auth state lives in
Redis, and the app automatically reconnects every previously-connected
session on boot (`resumeActiveSessions()` in `src/services/baileysManager.js`)
— so restarting/rebuilding the app does **not** require re-scanning the QR
code; your WhatsApp link reconnects on its own within a few seconds.

These volumes are Docker-managed storage (on Mac/Windows, inside Docker
Desktop's VM) rather than a plain folder in your project — inspect them with
`docker volume ls` / `docker volume inspect <name>` if you need to check they
exist, but you generally won't need to touch them directly.

## Running tests

```bash
npm install
npm test
```

`tests/level2Engine.test.js` mocks Prisma and the Ollama client to verify that
a matching `CorrectionRule` always bypasses the LLM call.

## Onboarding a tenant

A "tenant" is one onboarded account on this platform — it can represent a
business, or just you personally if you're running this as your own
assistant. `name` is purely a human-readable label with no functional effect;
call it whatever helps you tell tenants apart later.

`rateLimitMinutes` is an anti-spam guardrail: once a contact has received one
auto-reply, the pipeline won't auto-reply to that *same* contact again until
this many minutes have passed (checked in `src/queues/messageQueue.js` before
the message is even classified). It doesn't limit anything else — you can
still send messages manually, and different contacts are rate-limited
independently. The default `1440` (24 hours) means at most one auto-reply per
contact per day; use a smaller number for faster testing or chattier replies.

```bash
curl -X POST http://localhost:3000/api/v1/tenants \
  -H "Content-Type: application/json" \
  -d '{"name": "My Personal Assistant", "rateLimitMinutes": 1440}'
```

Most people should use the admin portal instead of this curl — see
[Onboarding from the admin portal](#onboarding-from-the-admin-portal-recommended).

The response includes an `apiKey` (server-generated — you don't choose it).
Copy that value; it's the `<TENANT_API_KEY>` used as the `x-api-key` header
on every call below. Keep it private — anyone with it can read your message
logs and control your WhatsApp session.

## Creating a WhatsApp session (scan QR)

```bash
curl -X POST http://localhost:3000/api/v1/sessions \
  -H "x-api-key: <TENANT_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"label": "Main Line"}'
```

This returns a `sessionId` immediately with `status: "PENDING_QR"` — the QR
itself takes a few seconds to generate. Poll for it:

```bash
curl http://localhost:3000/api/v1/sessions/<SESSION_ID> \
  -H "x-api-key: <TENANT_API_KEY>"
```

`qrCode` is a `data:image/png;base64,...` string — not something you can scan
from a terminal. The easiest way to view it: save the response and open it as
an HTML page.

```bash
curl -s http://localhost:3000/api/v1/sessions/<SESSION_ID> \
  -H "x-api-key: <TENANT_API_KEY>" \
  | python3 -c "
import json, sys, webbrowser, pathlib
qr = json.load(sys.stdin)['qrCode']
path = pathlib.Path('/tmp/qr.html')
path.write_text(f'<img src=\"{qr}\" style=\"width:300px\">')
webbrowser.open(f'file://{path}')
"
```

That opens the QR straight in your default browser. Scan it with **WhatsApp
→ Settings → Linked Devices → Link a Device**, then keep polling the same
`GET /sessions/<SESSION_ID>` endpoint until `status` becomes `"CONNECTED"` —
that confirms the link succeeded (it stays `"PENDING_QR"` until you scan).

## Testing the pipeline end-to-end

Once the session shows `"CONNECTED"`, send a WhatsApp message to that linked
number from another phone, then check what the pipeline did with it:

```bash
curl "http://localhost:3000/api/v1/messages" -H "x-api-key: <TENANT_API_KEY>"
```

You should see a new `MessageLog` row with `status`, `detectedLanguage`, and
`suggestedReply` populated. If `status` is `AUTO_REPLIED`, the sending phone
should receive a reply after a short "typing..." delay.

## Reviewing message logs

```bash
curl "http://localhost:3000/api/v1/messages?status=FLAGGED_FOR_REVIEW" \
  -H "x-api-key: <TENANT_API_KEY>"
```

## Creating a Level 2 correction rule

When an admin sees a wrong/missing auto-reply in `FLAGGED_FOR_REVIEW` logs:

```bash
curl -X POST http://localhost:3000/api/v1/corrections \
  -H "x-api-key: <TENANT_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "messageLogId": "<LOG_ID>",
    "pattern": "condolences|passed away|rip",
    "isRegex": true,
    "action": "SKIP_REPLY",
    "category": "BEREAVEMENT"
  }'
```

Future messages matching this pattern skip the LLM entirely and apply the
forced action.

## Notes on anti-ban behavior

The outgoing reply worker (`src/queues/replyQueue.js`) simulates human
behavior before every send: mark-as-read, a random 2-5s pause, a "composing"
presence update, then a typing delay proportional to reply length (40-70ms/
char with Gaussian jitter) before the message is actually sent. Per-contact
rate limiting (`Tenant.rateLimitMinutes`) additionally caps auto-replies to one
per contact per configured window.

## Admin & tenant web portals

Alongside the curl/API-key flow above, there's now a browser-based web
portal, served by its own Docker service:

```
http://localhost:8080
```

It's an nginx container (`web` service in `docker-compose.yml`) that serves a
built single-page app and reverse-proxies `/api/*` to the existing `app`
container internally — you don't need to expose port 3000 to use it, though
direct API access on port 3000 still works unchanged. Bring it up the same
way as everything else:

```bash
docker compose up -d --build
```

### Creating the first super-admin

There's no default admin account and none is auto-created on boot. Create
one with the one-time CLI script:

```bash
docker compose exec app node scripts/create-super-admin.js \
  --email=you@example.com --password=<choose-a-password> --name="Your Name"
```

(Or `npm run create-admin -- --email=... --password=...` for a local,
non-Docker setup.) Running it again with an email that already exists exits
with an error rather than creating a duplicate. Log in at
`http://localhost:8080/admin/login`.

### Onboarding from the admin portal (recommended)

This is the full path from "nothing" to "WhatsApp linked and auto-replying",
entirely in the browser. No curl, and no SMTP required.

1. **Log in** as super-admin at `http://localhost:8080/admin/login`.
2. **Create the tenant** at `http://localhost:8080/admin/tenants`. The create
   form is inline at the top of the tenant list and takes a **name** and a
   **rate limit in minutes** (pre-filled with `1440` = 24 hours). There is no
   separate "new tenant" page.
3. **Open the tenant** by clicking its name — `/admin/tenants/<id>`. This page
   shows the tenant's **API key** (the `x-api-key` credential, if you want
   programmatic access) and lets you edit the rate limit.
4. **Link WhatsApp**: click **New session**. A QR code appears within a few
   seconds; scan it from WhatsApp → *Linked devices* → *Link a device*. The
   page polls every 3 seconds, so the QR refreshes on its own as WhatsApp
   rotates it, and the status flips to `CONNECTED` with the phone number once
   linked. If a session later goes `DISCONNECTED` or `LOGGED_OUT`, a
   **Reconnect** button appears and produces a fresh QR in the same place.

   Each tenant supports exactly one WhatsApp connection, so **New session**
   disappears once a session exists — use **Reconnect** on the existing one
   instead. (The API returns 409 if you try anyway.) A second session would
   share the first's WhatsApp credentials and knock it permanently offline.

That's enough for auto-replies to start working. Steps 5-6 are only needed if
the tenant is someone *other than you* and should manage their own rules:

5. Set the tenant's **login email** on the same page and click **Save**.
6. Click **Send password reset** — the tenant gets an emailed link to choose
   their own password, then logs in at `http://localhost:8080/portal/login`.

Note that step 6 needs SMTP configured (see below); with `SMTP_HOST` unset the
email is silently skipped. And `send-password-reset` returns 400
`Tenant has no login email set` if step 5 is skipped — normal validation on a
required field, not a gap in the flow.

### Tenant login

Tenants log in at `http://localhost:8080/portal/login` using
`Tenant.loginEmail` / a password — not the `x-api-key` header used by the
curl flow. From their own portal they can create and reconnect WhatsApp
sessions (same QR flow as step 4 above), review flagged messages, and manage
correction rules.

The equivalent API calls, if you'd rather script it: `POST /admin/tenants`
(`name`, `rateLimitMinutes`), `PATCH /admin/tenants/:id` (`loginEmail`,
`rateLimitMinutes`, `status`), `POST /admin/tenants/:id/sessions`,
`POST /admin/tenants/:id/sessions/:sessionId/reconnect`, and
`POST /admin/tenants/:id/send-password-reset`.

### Environment variables for the portals

Set these in `.env` alongside the existing ones:

```bash
SESSION_SECRET="a-long-random-string"   # required — signs portal/admin session cookies

# required — public origin of the web portal. Password-reset links are built from
# this value, never from the request's Origin header (which the caller controls).
APP_BASE_URL="http://localhost:8080"

# Optional — defaults to false. Controls the Secure flag on the session cookie.
# Leave false for plain-HTTP access (including the local Docker stack on
# http://localhost:8080): a Secure cookie is silently dropped over HTTP, so login
# returns 200 while no session is ever created and the portal appears to reject
# valid credentials. Set to true only when the portal is served over HTTPS.
SESSION_COOKIE_SECURE=false

# Optional — email is best-effort; if unset, password-reset and
# disconnect-alert emails are skipped with a warning, nothing crashes.
SMTP_HOST=""
SMTP_PORT=587
SMTP_USER=""
SMTP_PASS=""
EMAIL_FROM="no-reply@yourdomain.com"
```
