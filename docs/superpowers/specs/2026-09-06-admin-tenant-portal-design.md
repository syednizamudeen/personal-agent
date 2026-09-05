# Admin & Tenant Web Portal — Design

Date: 2026-09-06
Status: Approved by user, ready for implementation planning

## Goal

Add a web UI on top of the existing curl-only API, with two roles:

- **Super-admin**: full cross-tenant control — view/edit any tenant's message logs and correction rules, manage tenants and their WhatsApp sessions, manage other super-admins, view an audit trail and basic system health.
- **Tenant-admin**: one login per tenant, scoped to managing their own auto-replies, correction rules, and WhatsApp session — replacing today's curl + API-key workflow for day-to-day use.

Also replaces the current curl-based onboarding (tenant creation + QR scanning) with a UI flow, and adds disconnect detection with email notification plus a one-click reconnect.

**Out of scope for v1** (explicitly deferred): billing, analytics/reporting beyond simple counts, multiple users per tenant (one login per tenant only), real-time (WebSocket) UI updates (polling is sufficient), impersonation/"login as tenant" for super-admins.

## Architecture

One additional deployable is added: a React SPA (`/web`), served by a new nginx Docker service that also reverse-proxies `/api/*` to the existing `app` service — so the browser only ever talks to one origin. The existing Express backend is extended in place (new route groups, new auth middleware) rather than split into a separate service; it already owns Prisma, Redis, and the Baileys session manager that all of this needs to touch.

The existing `x-api-key` tenant auth is untouched and continues to work exactly as today — portal auth is a fully separate layer alongside it, not a replacement.

```
Browser
  │
  ▼
nginx (web service, port 8080)
  ├─ /            → static React SPA build
  └─ /api/*       → proxied to app:3000
                        │
                        ▼
                  Express app (existing, extended)
                  ├─ /api/v1/*          existing x-api-key routes (unchanged)
                  ├─ /api/v1/portal/*   NEW, session-authed (tenant)
                  └─ /api/v1/admin/*    NEW, session-authed (super-admin)
                        │
                        ▼
                  Postgres / Redis / BullMQ / Ollama (existing)
```

## Data model changes (Prisma)

Additions to `prisma/schema.prisma`:

```prisma
model Tenant {
  // ...existing fields unchanged...
  loginEmail   String?  @unique
  passwordHash String?
  status       TenantStatus @default(ACTIVE)
}

enum TenantStatus {
  ACTIVE
  SUSPENDED
}

model SuperAdmin {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model AuditLog {
  id         String   @id @default(uuid())
  actorType  ActorType
  actorId    String
  action     String
  targetType String
  targetId   String
  tenantId   String?  // which tenant was affected, even if actor is a super-admin
  beforeData Json?
  afterData  Json?
  createdAt  DateTime @default(now())

  @@index([tenantId])
  @@index([actorType, actorId])
  @@index([createdAt])
}

enum ActorType {
  SUPER_ADMIN
  TENANT
}

model PasswordResetToken {
  id         String    @id @default(uuid())
  actorType  ActorType
  actorId    String
  tokenHash  String    @unique
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime  @default(now())

  @@index([actorType, actorId])
}

model WhatsAppSession {
  // ...existing fields unchanged...
  disconnectNotifiedAt DateTime?
}
```

`Tenant.status = SUSPENDED` disables login and auto-replies without deleting any data (message logs, rules, audit history stay intact). True deletion of a tenant remains possible via the existing cascade-delete relations, but is a deliberate, rare super-admin action — not exposed as a casual "delete" button tied to normal tenant management.

## Auth & sessions

- **Session store**: `express-session` + `connect-redis`, reusing the existing Redis instance. Cookie: httpOnly, `sameSite=lax`, `secure` in production.
- **Two new middlewares**:
  - `requireTenantSession` — reads `req.session.tenantId`, loads the `Tenant`, attaches `req.tenant`. Rejects if `Tenant.status !== 'ACTIVE'`.
  - `requireSuperAdmin` — reads `req.session.superAdminId`, loads the `SuperAdmin`, attaches `req.superAdmin`.
- A session holds at most one identity field, never both.
- **Login**: `POST /api/v1/portal/login` and `POST /api/v1/admin/login` — email + bcrypt password check, then `req.session.regenerate()` before setting the identity field (prevents session fixation).
- **Logout**: `POST /api/v1/portal/logout`, `POST /api/v1/admin/logout` — `req.session.destroy()`.
- **Existing `sessionController`/`reviewController` logic is reused as-is** for portal routes — those controllers already operate on `req.tenant`; `requireTenantSession` populates it the same way the existing `requireTenant` (api-key) middleware does. No duplicated business logic between the two auth paths.

### Password reset

- `PasswordResetToken`: single-use, 1-hour expiry, stores a hash of the token (raw token only ever appears in the emailed link).
- Self-service: `POST /api/v1/portal/forgot-password` (email only; always returns a generic success response regardless of whether the email matched, to avoid account enumeration) → emailed link → `POST /api/v1/portal/reset-password` (token + new password; on success, invalidates the token and destroys all other existing sessions for that account).
- On-demand from the admin portal: `POST /api/v1/admin/tenants/:id/send-password-reset` — a super-admin triggers the same reset email directly for a tenant, no self-service step required. Writes an `AuditLog` entry.
- Same reset flow and token model apply to `SuperAdmin` accounts (`actorType: SUPER_ADMIN`).

## API surface

**Tenant portal** (`/api/v1/portal/*`, `requireTenantSession` except where noted):
- `POST /login`, `POST /logout` (public)
- `POST /forgot-password`, `POST /reset-password` (public)
- `PATCH /change-password`
- `GET /me`, `PATCH /me` — own profile/settings (rate limit hours, display name)
- `GET /sessions`, `POST /sessions` (new session, first-time onboarding), `GET /sessions/:id` (poll status/QR), `POST /sessions/:id/reconnect` (re-link after logout)
- `GET /messages` — own message logs
- `GET /corrections`, `POST /corrections`, `DELETE /corrections/:id` — own rules

**Super-admin** (`/api/v1/admin/*`, `requireSuperAdmin` except login):
- `POST /login`, `POST /logout`
- `GET /tenants`, `POST /tenants`, `GET /tenants/:id`, `PATCH /tenants/:id` (includes status change)
- `POST /tenants/:id/send-password-reset`
- `GET /tenants/:id/messages`
- `GET /tenants/:id/corrections`, `POST /tenants/:id/corrections`, `DELETE /tenants/:id/corrections/:ruleId`
- `GET /tenants/:id/sessions`, `POST /tenants/:id/sessions/:sid/reconnect`
- `GET /audit-logs` — filterable by tenant, actor, action, date range
- `GET /system/health` — BullMQ queue depth (waiting/active/failed counts), Ollama reachability check, Postgres/Redis connectivity
- `GET /super-admins`, `POST /super-admins`

Every state-changing admin/portal action writes an `AuditLog` row (actor, action, target, before/after snapshot) — this is the mechanism, not a separate feature to build per-endpoint.

All list endpoints (`GET /messages`, `GET /audit-logs`, `GET /tenants`, `GET /tenants/:id/messages`, etc.) support `limit`/pagination, following the existing convention already in `sessionController.listMessageLogs` — these grow unbounded over time and must not return everything by default.

## Disconnect detection, reconnect, and notifications

- **Detection**: in `baileysManager.js`'s existing `connection.update` handler, the `LOGGED_OUT` branch checks `WhatsAppSession.disconnectNotifiedAt`. If null, sends a disconnect-alert email to `Tenant.loginEmail` (if set) and sets `disconnectNotifiedAt = now()`. A later successful reconnect (`connection === 'open'`) resets it to null, so a future disconnect can alert again. One email per disconnect event.
- **Transient drops** (not `loggedOut`) are unaffected — the existing auto-reconnect-with-stored-creds logic already handles these silently, no email needed.
- **Reconnecting**: `POST /sessions/:id/reconnect` reuses the existing session row (flips status to `PENDING_QR`, calls `startSession()` again) rather than creating a new row — avoids accumulating dead `LOGGED_OUT` rows every time a phone unlinks. Available to the tenant (own session) and to a super-admin (any tenant's session). A human triggering this writes an `AuditLog` entry (`SESSION_RECONNECT_TRIGGERED`); the automatic disconnect detection itself does not, since it's a system state change already visible via `WhatsAppSession.status`, not a human action.
- **Super-admin visibility**: no separate alert channel for super-admins — the admin dashboard includes a "disconnected sessions" panel querying `WhatsAppSession` by status, which is sufficient.

## Email service

- `src/services/emailService.js` wrapping `nodemailer` over plain SMTP (`SMTP_HOST`/`PORT`/`USER`/`PASS`/`EMAIL_FROM` env vars) — no vendor-specific SDK, works with any mailbox.
- Two templates: password-reset, disconnect-alert.

## Frontend

- New `/web` directory: Vite + React + TypeScript.
- Styling: Tailwind CSS + shadcn/ui, matching the approved "Dark Ops Console" visual direction (dense, dark-by-default, monospace accents) — polish/theming pass deferred to a later iteration, not blocking v1.
- Routing: `react-router`, two top-level trees (`/admin/*`, `/portal/*`) in one SPA build, route-guarded by which session type is active.
- Server state: TanStack Query — used for both data fetching/caching and polling (e.g. session connection status, disconnected-sessions panel) rather than adding WebSockets.
- Responsive: desktop-first (primary target), responsive layout so nothing breaks on mobile — not a primary design target for v1.
- No charting library for v1 — the dashboard is fundamentally tables (tenants, messages, audit logs), not visualizations.

## Deployment

- New `web` service in `docker-compose.yml`: multi-stage Dockerfile (Node build → nginx), same pattern as the existing app `Dockerfile`. nginx serves the SPA and proxies `/api/*` to `app` internally.
- New port (e.g. `8080:80`) for the web UI; existing `3000` (app, direct API/curl access) is unchanged.
- New env vars on `app`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`.
- New backend dependencies: `bcrypt`, `express-session`, `connect-redis`, `nodemailer`.
- One new Prisma migration covering all schema changes above.
- First super-admin created via a one-time CLI script (`node scripts/create-super-admin.js --email=... --password=...`), not auto-seeded from env vars on every boot.

## Testing

- Unit tests (Jest, matching existing style — mock Prisma/email/Redis) for: password hashing/verification, password-reset token lifecycle (issue, use, expiry, single-use), audit-log writing on state-changing actions, the `disconnectNotifiedAt` set/reset logic, and the suspend-blocks-login behavior.
- Existing `tests/level2Engine.test.js` is unaffected by any of this.

## Documentation

Per standing project instruction, `README.md` and `CLAUDE.md` get updated as each piece of this lands — not deferred to the end. `CLAUDE.md`'s existing "Planned: admin + tenant web portals" section gets replaced with concrete architecture notes once built, following the same style as its other sections (what exists, why, and the non-obvious gotchas).
