# Admin & Tenant Web Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-based login for tenants and a new super-admin role, expose both through new `/api/v1/portal/*` and `/api/v1/admin/*` routes, add password reset, disconnect-notification email, one-click reconnect, an audit trail, and a React/TypeScript web UI for all of it.

**Architecture:** Extend the existing Express app in place (new middleware, new route groups) rather than a separate backend service; existing `x-api-key` routes and controllers (`sessionController`, `reviewController`) are reused unchanged by portal routes since they already operate on `req.tenant` generically. A new React SPA (`/web`) is served by a new nginx Docker service that proxies `/api/*` to the existing app, so the browser only ever talks to one origin.

**Tech Stack:** Express, `express-session` + `connect-redis`, `bcrypt`, `nodemailer`, Prisma/Postgres, BullMQ/Redis (all existing) + Vite, React, TypeScript, Tailwind CSS, `react-router-dom`, `@tanstack/react-query`, `supertest` (new, backend route testing).

**Spec:** `docs/superpowers/specs/2026-09-06-admin-tenant-portal-design.md`

## Global Constraints

- Existing `x-api-key` tenant auth (`requireTenant` in `src/routes/api.js`) is untouched — portal/admin auth is a fully separate layer alongside it.
- One login per tenant — auth fields live directly on `Tenant`, no separate multi-user table.
- Session store is `express-session` + `connect-redis` (real Redis in dev/prod; `express-session`'s in-memory `MemoryStore` in tests — no test ever touches real Redis or Postgres, matching the existing `tests/level2Engine.test.js` convention of mocking Prisma).
- Passwords hashed with `bcrypt`, never stored or logged in plaintext.
- Email is sent via plain SMTP through `nodemailer` — no vendor-specific SDK.
- `Tenant.status = SUSPENDED` blocks login and auto-replies; it never deletes data.
- Every state-changing admin/portal action writes one `AuditLog` row.
- All list endpoints support `limit` (default 50, max 200), matching the existing convention in `sessionController.listMessageLogs`.
- Frontend: Vite + React + TypeScript, Tailwind CSS (hand-built primitive components in the spirit of shadcn/ui — see Task 20 — rather than running the shadcn CLI scaffold, to keep every file in this plan fully specified), `react-router-dom` with two route trees (`/admin/*`, `/portal/*`) in one SPA build, `@tanstack/react-query` for server state and polling, no charting library, desktop-first responsive layout.
- New `web` Docker service (nginx) proxies `/api/*` to `app:3000`; existing port `3000` is untouched.
- First super-admin is created via a one-time CLI script, never auto-seeded from env vars on boot.

---

## Task 1: Prisma schema changes

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_portal_auth_models/migration.sql` (generated)

**Interfaces:**
- Produces: `Tenant.loginEmail`, `Tenant.passwordHash`, `Tenant.status` (`TenantStatus` enum: `ACTIVE`, `SUSPENDED`); `SuperAdmin` model (`id`, `email`, `passwordHash`, `name`, `createdAt`, `updatedAt`); `AuditLog` model (`id`, `actorType` (`ActorType` enum: `SUPER_ADMIN`, `TENANT`), `actorId`, `action`, `targetType`, `targetId`, `tenantId`, `beforeData`, `afterData`, `createdAt`); `PasswordResetToken` model (`id`, `actorType`, `actorId`, `tokenHash`, `expiresAt`, `usedAt`, `createdAt`); `WhatsAppSession.disconnectNotifiedAt`.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Add `status` and auth fields to the existing `Tenant` model — find the `model Tenant {` block and add these fields inside it (alongside the existing `rateLimitHours` field):

```prisma
  loginEmail     String?      @unique
  passwordHash   String?
  status         TenantStatus @default(ACTIVE)
```

Add the new enum near the other enums at the top of the file:

```prisma
enum TenantStatus {
  ACTIVE
  SUSPENDED
}

enum ActorType {
  SUPER_ADMIN
  TENANT
}
```

Add a field to the existing `WhatsAppSession` model (alongside `qrCode`):

```prisma
  disconnectNotifiedAt DateTime?
```

Append these new models at the end of the file:

```prisma
model SuperAdmin {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("super_admins")
}

model AuditLog {
  id         String    @id @default(uuid())
  actorType  ActorType
  actorId    String
  action     String
  targetType String
  targetId   String
  tenantId   String?
  beforeData Json?
  afterData  Json?
  createdAt  DateTime  @default(now())

  @@index([tenantId])
  @@index([actorType, actorId])
  @@index([createdAt])
  @@map("audit_logs")
}

model PasswordResetToken {
  id        String    @id @default(uuid())
  actorType ActorType
  actorId   String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([actorType, actorId])
  @@map("password_reset_tokens")
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_portal_auth_models`
Expected: `Your database is now in sync with your schema.` and a new file under `prisma/migrations/`.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add tenant auth fields, super admins, audit log, password reset tokens"
```

---

## Task 2: Session middleware config

**Files:**
- Create: `src/config/session.js`
- Create: `tests/config/session.test.js`
- Modify: `src/config/env.js` (add `SESSION_SECRET` to required vars)
- Modify: `.env.example` (add `SESSION_SECRET`)
- Modify: `package.json` (add `express-session`, `connect-redis` deps)

**Interfaces:**
- Produces: `createSessionMiddleware(store?)` — returns configured `express-session` middleware; when `store` is omitted, uses a real `connect-redis` store; when passed (e.g. `new session.MemoryStore()`), uses that instead (for tests).

- [ ] **Step 1: Install dependencies**

Run: `npm install express-session connect-redis`

- [ ] **Step 2: Add `SESSION_SECRET` to env config**

In `src/config/env.js`, add `'SESSION_SECRET'` to the `required` array, and add to the exported object:

```js
sessionSecret: process.env.SESSION_SECRET,
```

- [ ] **Step 3: Add to `.env.example`**

```
# Session (portal/admin login)
SESSION_SECRET="change-me-to-a-long-random-string"
```

- [ ] **Step 4: Write the failing test**

Create `tests/config/session.test.js`:

```js
const session = require('express-session');
const { createSessionMiddleware } = require('../../src/config/session');

describe('createSessionMiddleware', () => {
  it('returns an express-session middleware using the provided store', () => {
    const store = new session.MemoryStore();
    const middleware = createSessionMiddleware(store);
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest tests/config/session.test.js`
Expected: FAIL — `Cannot find module '../../src/config/session'`

- [ ] **Step 6: Implement `src/config/session.js`**

```js
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { sessionSecret } = require('./env');
const { createRedisConnection } = require('./redis');

function createSessionMiddleware(store) {
  return session({
    store: store || new RedisStore({ client: createRedisConnection(), prefix: 'sess:' }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}

module.exports = { createSessionMiddleware };
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest tests/config/session.test.js`
Expected: PASS

- [ ] **Step 8: Update `tests/setupEnv.js`**

Add: `process.env.SESSION_SECRET ||= 'test-session-secret';`

- [ ] **Step 9: Commit**

```bash
git add src/config/session.js src/config/env.js .env.example tests/config/session.test.js tests/setupEnv.js package.json package-lock.json
git commit -m "feat(auth): add configurable session middleware"
```

---

## Task 3: Password hashing service

**Files:**
- Create: `src/services/authService.js`
- Create: `tests/services/authService.test.js`
- Modify: `package.json` (add `bcrypt`)

**Interfaces:**
- Produces: `hashPassword(plain: string) => Promise<string>`, `verifyPassword(plain: string, hash: string) => Promise<boolean>`.

- [ ] **Step 1: Install dependency**

Run: `npm install bcrypt`

- [ ] **Step 2: Write the failing test**

Create `tests/services/authService.test.js`:

```js
const { hashPassword, verifyPassword } = require('../../src/services/authService');

describe('authService', () => {
  it('hashes a password and verifies the correct password against it', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/services/authService.test.js`
Expected: FAIL — `Cannot find module '../../src/services/authService'`

- [ ] **Step 4: Implement `src/services/authService.js`**

```js
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/services/authService.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/authService.js tests/services/authService.test.js package.json package-lock.json
git commit -m "feat(auth): add bcrypt password hashing service"
```

---

## Task 4: Audit log service

**Files:**
- Create: `src/services/auditService.js`
- Create: `tests/services/auditService.test.js`

**Interfaces:**
- Consumes: `prisma.auditLog.create` (from Task 1's schema)
- Produces: `writeAuditLog({ actorType, actorId, action, targetType, targetId, tenantId, beforeData, afterData }) => Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/services/auditService.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  auditLog: { create: jest.fn() },
}));

const prisma = require('../../src/db/prisma');
const { writeAuditLog } = require('../../src/services/auditService');

describe('writeAuditLog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes an audit log row with the given fields', async () => {
    await writeAuditLog({
      actorType: 'SUPER_ADMIN',
      actorId: 'admin-1',
      action: 'TENANT_SUSPENDED',
      targetType: 'Tenant',
      targetId: 'tenant-1',
      tenantId: 'tenant-1',
      beforeData: { status: 'ACTIVE' },
      afterData: { status: 'SUSPENDED' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'SUPER_ADMIN',
        actorId: 'admin-1',
        action: 'TENANT_SUSPENDED',
        targetType: 'Tenant',
        targetId: 'tenant-1',
        tenantId: 'tenant-1',
        beforeData: { status: 'ACTIVE' },
        afterData: { status: 'SUSPENDED' },
      },
    });
  });

  it('defaults beforeData/afterData/tenantId to null when omitted', async () => {
    await writeAuditLog({
      actorType: 'TENANT',
      actorId: 'tenant-1',
      action: 'CORRECTION_RULE_CREATED',
      targetType: 'CorrectionRule',
      targetId: 'rule-1',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'TENANT',
        actorId: 'tenant-1',
        action: 'CORRECTION_RULE_CREATED',
        targetType: 'CorrectionRule',
        targetId: 'rule-1',
        tenantId: null,
        beforeData: null,
        afterData: null,
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/services/auditService.test.js`
Expected: FAIL — `Cannot find module '../../src/services/auditService'`

- [ ] **Step 3: Implement `src/services/auditService.js`**

```js
const prisma = require('../db/prisma');

async function writeAuditLog({ actorType, actorId, action, targetType, targetId, tenantId, beforeData, afterData }) {
  await prisma.auditLog.create({
    data: {
      actorType,
      actorId,
      action,
      targetType,
      targetId,
      tenantId: tenantId ?? null,
      beforeData: beforeData ?? null,
      afterData: afterData ?? null,
    },
  });
}

module.exports = { writeAuditLog };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/services/auditService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/auditService.js tests/services/auditService.test.js
git commit -m "feat(audit): add audit log writer service"
```

---

## Task 5: Session-auth middlewares

**Files:**
- Create: `src/middleware/requireTenantSession.js`
- Create: `src/middleware/requireSuperAdmin.js`
- Create: `tests/middleware/requireTenantSession.test.js`
- Create: `tests/middleware/requireSuperAdmin.test.js`
- Modify: `package.json` (add `supertest` devDependency)

**Interfaces:**
- Consumes: `prisma.tenant.findUnique`, `prisma.superAdmin.findUnique`
- Produces: `requireTenantSession(req, res, next)` — sets `req.tenant` from `req.session.tenantId`, 401s if missing/not found, 403s if `status !== 'ACTIVE'`. `requireSuperAdmin(req, res, next)` — sets `req.superAdmin` from `req.session.superAdminId`, 401s if missing/not found.

- [ ] **Step 1: Install test dependency**

Run: `npm install --save-dev supertest`

- [ ] **Step 2: Write the failing test for `requireTenantSession`**

Create `tests/middleware/requireTenantSession.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  tenant: { findUnique: jest.fn() },
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const prisma = require('../../src/db/prisma');
const requireTenantSession = require('../../src/middleware/requireTenantSession');

function buildApp() {
  const app = express();
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.post('/set-session', (req, res) => {
    req.session.tenantId = req.body.tenantId;
    res.json({ ok: true });
  });
  app.get('/protected', requireTenantSession, (req, res) => res.json({ tenantId: req.tenant.id }));
  return app;
}

describe('requireTenantSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects with 401 when there is no session', async () => {
    const app = buildApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('attaches req.tenant and calls next when the session tenant is ACTIVE', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/set-session').send({ tenantId: 'tenant-1' });
    const res = await agent.get('/protected');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenantId: 'tenant-1' });
  });

  it('rejects with 403 when the tenant is SUSPENDED', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', status: 'SUSPENDED' });
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/set-session').send({ tenantId: 'tenant-1' });
    const res = await agent.get('/protected');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/middleware/requireTenantSession.test.js`
Expected: FAIL — `Cannot find module '../../src/middleware/requireTenantSession'`

- [ ] **Step 4: Implement `src/middleware/requireTenantSession.js`**

```js
const prisma = require('../db/prisma');

async function requireTenantSession(req, res, next) {
  const tenantId = req.session?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Not logged in' });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return res.status(401).json({ error: 'Not logged in' });
  if (tenant.status !== 'ACTIVE') return res.status(403).json({ error: 'Account suspended' });

  req.tenant = tenant;
  next();
}

module.exports = requireTenantSession;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/middleware/requireTenantSession.test.js`
Expected: PASS

- [ ] **Step 6: Write the failing test for `requireSuperAdmin`**

Create `tests/middleware/requireSuperAdmin.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  superAdmin: { findUnique: jest.fn() },
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const prisma = require('../../src/db/prisma');
const requireSuperAdmin = require('../../src/middleware/requireSuperAdmin');

function buildApp() {
  const app = express();
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.post('/set-session', (req, res) => {
    req.session.superAdminId = req.body.superAdminId;
    res.json({ ok: true });
  });
  app.get('/protected', requireSuperAdmin, (req, res) => res.json({ superAdminId: req.superAdmin.id }));
  return app;
}

describe('requireSuperAdmin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects with 401 when there is no session', async () => {
    const app = buildApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('attaches req.superAdmin and calls next when the session is valid', async () => {
    prisma.superAdmin.findUnique.mockResolvedValue({ id: 'admin-1', email: 'a@b.com' });
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/set-session').send({ superAdminId: 'admin-1' });
    const res = await agent.get('/protected');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ superAdminId: 'admin-1' });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx jest tests/middleware/requireSuperAdmin.test.js`
Expected: FAIL — `Cannot find module '../../src/middleware/requireSuperAdmin'`

- [ ] **Step 8: Implement `src/middleware/requireSuperAdmin.js`**

```js
const prisma = require('../db/prisma');

async function requireSuperAdmin(req, res, next) {
  const superAdminId = req.session?.superAdminId;
  if (!superAdminId) return res.status(401).json({ error: 'Not logged in' });

  const superAdmin = await prisma.superAdmin.findUnique({ where: { id: superAdminId } });
  if (!superAdmin) return res.status(401).json({ error: 'Not logged in' });

  req.superAdmin = superAdmin;
  next();
}

module.exports = requireSuperAdmin;
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx jest tests/middleware/requireSuperAdmin.test.js`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/middleware tests/middleware package.json package-lock.json
git commit -m "feat(auth): add session-based tenant and super-admin middlewares"
```

---

## Task 6: Portal and admin login/logout endpoints

**Files:**
- Create: `src/controllers/portalAuthController.js`
- Create: `src/controllers/adminAuthController.js`
- Create: `src/routes/portal.js`
- Create: `src/routes/admin.js`
- Create: `tests/controllers/portalAuthController.test.js`
- Create: `tests/controllers/adminAuthController.test.js`
- Modify: `src/server.js` (mount session middleware + new routers)

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 3), `requireTenantSession`/`requireSuperAdmin` (Task 5), `createSessionMiddleware` (Task 2)
- Produces: `POST /api/v1/portal/login`, `POST /api/v1/portal/logout`, `POST /api/v1/admin/login`, `POST /api/v1/admin/logout`

- [ ] **Step 1: Write the failing test for portal login**

Create `tests/controllers/portalAuthController.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  tenant: { findUnique: jest.fn() },
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const prisma = require('../../src/db/prisma');
const { verifyPassword } = require('../../src/services/authService');
const portalAuthRouter = require('../../src/controllers/portalAuthController');

jest.mock('../../src/services/authService', () => ({
  verifyPassword: jest.fn(),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use('/portal', portalAuthRouter);
  return app;
}

describe('POST /portal/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when no tenant matches the email', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post('/portal/login').send({ email: 'x@y.com', password: 'pw' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when the password is wrong', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', loginEmail: 'x@y.com', passwordHash: 'hash', status: 'ACTIVE' });
    verifyPassword.mockResolvedValue(false);
    const res = await request(buildApp()).post('/portal/login').send({ email: 'x@y.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when the tenant is suspended', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', loginEmail: 'x@y.com', passwordHash: 'hash', status: 'SUSPENDED' });
    verifyPassword.mockResolvedValue(true);
    const res = await request(buildApp()).post('/portal/login').send({ email: 'x@y.com', password: 'pw' });
    expect(res.status).toBe(403);
  });

  it('logs in and sets the session on correct credentials', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', loginEmail: 'x@y.com', passwordHash: 'hash', status: 'ACTIVE' });
    verifyPassword.mockResolvedValue(true);
    const res = await request(buildApp()).post('/portal/login').send({ email: 'x@y.com', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenantId: 't1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/controllers/portalAuthController.test.js`
Expected: FAIL — `Cannot find module '../../src/controllers/portalAuthController'`

- [ ] **Step 3: Implement `src/controllers/portalAuthController.js`**

```js
const express = require('express');
const prisma = require('../db/prisma');
const { verifyPassword } = require('../services/authService');
const requireTenantSession = require('../middleware/requireTenantSession');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const tenant = await prisma.tenant.findUnique({ where: { loginEmail: email } });
  if (!tenant || !(await verifyPassword(password, tenant.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (tenant.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Account suspended' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.tenantId = tenant.id;
    res.json({ tenantId: tenant.id });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireTenantSession, (req, res) => {
  res.json({ id: req.tenant.id, name: req.tenant.name, loginEmail: req.tenant.loginEmail, rateLimitHours: req.tenant.rateLimitHours });
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/controllers/portalAuthController.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for admin login**

Create `tests/controllers/adminAuthController.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  superAdmin: { findUnique: jest.fn() },
}));
jest.mock('../../src/services/authService', () => ({
  verifyPassword: jest.fn(),
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const prisma = require('../../src/db/prisma');
const { verifyPassword } = require('../../src/services/authService');
const adminAuthRouter = require('../../src/controllers/adminAuthController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use('/admin', adminAuthRouter);
  return app;
}

describe('POST /admin/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 for unknown email', async () => {
    prisma.superAdmin.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post('/admin/login').send({ email: 'x@y.com', password: 'pw' });
    expect(res.status).toBe(401);
  });

  it('logs in and sets the session on correct credentials', async () => {
    prisma.superAdmin.findUnique.mockResolvedValue({ id: 'admin-1', email: 'x@y.com', passwordHash: 'hash' });
    verifyPassword.mockResolvedValue(true);
    const res = await request(buildApp()).post('/admin/login').send({ email: 'x@y.com', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ superAdminId: 'admin-1' });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest tests/controllers/adminAuthController.test.js`
Expected: FAIL — `Cannot find module '../../src/controllers/adminAuthController'`

- [ ] **Step 7: Implement `src/controllers/adminAuthController.js`**

```js
const express = require('express');
const prisma = require('../db/prisma');
const { verifyPassword } = require('../services/authService');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const superAdmin = await prisma.superAdmin.findUnique({ where: { email } });
  if (!superAdmin || !(await verifyPassword(password, superAdmin.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.superAdminId = superAdmin.id;
    res.json({ superAdminId: superAdmin.id });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireSuperAdmin, (req, res) => {
  res.json({ id: req.superAdmin.id, email: req.superAdmin.email, name: req.superAdmin.name });
});

module.exports = router;
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest tests/controllers/adminAuthController.test.js`
Expected: PASS

- [ ] **Step 9: Create route entry points**

Create `src/routes/portal.js`:

```js
const express = require('express');
const portalAuthController = require('../controllers/portalAuthController');

const router = express.Router();
router.use('/', portalAuthController);

module.exports = router;
```

Create `src/routes/admin.js`:

```js
const express = require('express');
const adminAuthController = require('../controllers/adminAuthController');

const router = express.Router();
router.use('/', adminAuthController);

module.exports = router;
```

- [ ] **Step 10: Wire session middleware and new routers into `src/server.js`**

In `src/server.js`, add near the top:

```js
const { createSessionMiddleware } = require('./config/session');
const portalRoutes = require('./routes/portal');
const adminRoutes = require('./routes/admin');
```

After `app.use(express.json(...))`, add:

```js
app.use(createSessionMiddleware());
```

After `app.use('/api/v1', apiRoutes);`, add:

```js
app.use('/api/v1/portal', portalRoutes);
app.use('/api/v1/admin', adminRoutes);
```

- [ ] **Step 11: Run full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 12: Commit**

```bash
git add src/controllers/portalAuthController.js src/controllers/adminAuthController.js src/routes/portal.js src/routes/admin.js src/server.js tests/controllers
git commit -m "feat(auth): add portal and admin login/logout endpoints"
```

---

## Task 7: Email service

**Files:**
- Create: `src/services/emailService.js`
- Create: `tests/services/emailService.test.js`
- Modify: `.env.example` (SMTP vars)
- Modify: `src/config/env.js` (SMTP config, not in `required` — email is best-effort, missing config just logs a warning rather than crashing boot)
- Modify: `package.json` (add `nodemailer`)

**Interfaces:**
- Produces: `sendPasswordResetEmail(to: string, resetUrl: string) => Promise<void>`, `sendDisconnectAlertEmail(to: string, tenantName: string) => Promise<void>`

- [ ] **Step 1: Install dependency**

Run: `npm install nodemailer`

- [ ] **Step 2: Add SMTP config**

In `src/config/env.js`, add to the exported object (not to `required`):

```js
smtp: {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.EMAIL_FROM || 'no-reply@localhost',
},
```

In `.env.example`, add:

```
# Email (password reset, disconnect alerts)
SMTP_HOST=""
SMTP_PORT=587
SMTP_USER=""
SMTP_PASS=""
EMAIL_FROM="no-reply@yourdomain.com"
```

- [ ] **Step 3: Write the failing test**

Create `tests/services/emailService.test.js`:

```js
const mockSendMail = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const { sendPasswordResetEmail, sendDisconnectAlertEmail } = require('../../src/services/emailService');

describe('emailService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends a password reset email with the reset URL in the body', async () => {
    await sendPasswordResetEmail('tenant@example.com', 'https://app.example.com/reset-password?token=abc');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'tenant@example.com',
        subject: expect.stringContaining('Reset'),
        html: expect.stringContaining('https://app.example.com/reset-password?token=abc'),
      })
    );
  });

  it('sends a disconnect alert email naming the tenant', async () => {
    await sendDisconnectAlertEmail('tenant@example.com', 'Acme Tours');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'tenant@example.com',
        subject: expect.stringContaining('Disconnected'),
        html: expect.stringContaining('Acme Tours'),
      })
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest tests/services/emailService.test.js`
Expected: FAIL — `Cannot find module '../../src/services/emailService'`

- [ ] **Step 5: Implement `src/services/emailService.js`**

```js
const nodemailer = require('nodemailer');
const { smtp } = require('../config/env');
const logger = require('../config/logger');

const transporter = nodemailer.createTransport({
  host: smtp.host,
  port: smtp.port,
  auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
});

async function send(to, subject, html) {
  if (!smtp.host) {
    logger.warn({ to, subject }, 'SMTP not configured, skipping email send');
    return;
  }
  await transporter.sendMail({ from: smtp.from, to, subject, html });
}

async function sendPasswordResetEmail(to, resetUrl) {
  await send(
    to,
    'Reset your password',
    `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
  );
}

async function sendDisconnectAlertEmail(to, tenantName) {
  await send(
    to,
    'WhatsApp Disconnected',
    `<p>The WhatsApp connection for <strong>${tenantName}</strong> was disconnected and needs to be re-linked. Log in to the portal and click "Reconnect device" to generate a new QR code.</p>`
  );
}

module.exports = { sendPasswordResetEmail, sendDisconnectAlertEmail };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/services/emailService.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/emailService.js src/config/env.js .env.example tests/services/emailService.test.js package.json package-lock.json
git commit -m "feat(email): add SMTP email service for password reset and disconnect alerts"
```

---

## Task 8: Password reset service and endpoints

**Files:**
- Create: `src/services/passwordResetService.js`
- Create: `tests/services/passwordResetService.test.js`
- Modify: `src/controllers/portalAuthController.js` (add forgot/reset/change-password)
- Modify: `src/controllers/adminAuthController.js` (add forgot/reset password for super-admins, for parity)
- Create: `tests/controllers/portalPasswordReset.test.js`
- Modify: `package.json` (add `crypto` is built-in, no new dep needed beyond what's installed)

**Interfaces:**
- Consumes: `prisma.passwordResetToken`, `hashPassword` (Task 3), `sendPasswordResetEmail` (Task 7)
- Produces: `issueResetToken(actorType, actorId) => Promise<string>` (returns the raw token), `consumeResetToken(rawToken) => Promise<{ actorType, actorId } | null>`

- [ ] **Step 1: Write the failing test**

Create `tests/services/passwordResetService.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
}));

const prisma = require('../../src/db/prisma');
const { issueResetToken, consumeResetToken } = require('../../src/services/passwordResetService');

describe('passwordResetService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('issues a token and stores only its hash', async () => {
    prisma.passwordResetToken.create.mockResolvedValue({});
    const token = await issueResetToken('TENANT', 'tenant-1');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);

    const [[createArgs]] = prisma.passwordResetToken.create.mock.calls;
    expect(createArgs.data.tokenHash).not.toBe(token);
    expect(createArgs.data.actorType).toBe('TENANT');
    expect(createArgs.data.actorId).toBe('tenant-1');
    expect(createArgs.data.expiresAt).toBeInstanceOf(Date);
  });

  it('consumes a valid, unused, unexpired token and marks it used', async () => {
    const token = 'raw-token-value';
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt-1',
      actorType: 'TENANT',
      actorId: 'tenant-1',
      tokenHash,
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    prisma.passwordResetToken.update.mockResolvedValue({});

    const result = await consumeResetToken(token);
    expect(result).toEqual({ actorType: 'TENANT', actorId: 'tenant-1' });
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'prt-1' },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('returns null for an already-used token', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt-1',
      actorType: 'TENANT',
      actorId: 'tenant-1',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    const result = await consumeResetToken('raw-token-value');
    expect(result).toBeNull();
  });

  it('returns null for an expired token', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt-1',
      actorType: 'TENANT',
      actorId: 'tenant-1',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const result = await consumeResetToken('raw-token-value');
    expect(result).toBeNull();
  });

  it('returns null when no token matches', async () => {
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    const result = await consumeResetToken('nonexistent');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/services/passwordResetService.test.js`
Expected: FAIL — `Cannot find module '../../src/services/passwordResetService'`

- [ ] **Step 3: Implement `src/services/passwordResetService.js`**

```js
const crypto = require('crypto');
const prisma = require('../db/prisma');

const TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueResetToken(actorType, actorId) {
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: {
      actorType,
      actorId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return token;
}

async function consumeResetToken(rawToken) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!record) return null;
  if (record.usedAt) return null;
  if (record.expiresAt.getTime() < Date.now()) return null;

  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return { actorType: record.actorType, actorId: record.actorId };
}

module.exports = { issueResetToken, consumeResetToken };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/services/passwordResetService.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for the portal forgot/reset endpoints**

Create `tests/controllers/portalPasswordReset.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  tenant: { findUnique: jest.fn(), update: jest.fn() },
}));
jest.mock('../../src/services/passwordResetService', () => ({
  issueResetToken: jest.fn(),
  consumeResetToken: jest.fn(),
}));
jest.mock('../../src/services/emailService', () => ({
  sendPasswordResetEmail: jest.fn(),
}));
jest.mock('../../src/services/authService', () => ({
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const prisma = require('../../src/db/prisma');
const { issueResetToken, consumeResetToken } = require('../../src/services/passwordResetService');
const { sendPasswordResetEmail } = require('../../src/services/emailService');
const { hashPassword } = require('../../src/services/authService');
const portalAuthRouter = require('../../src/controllers/portalAuthController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use('/portal', portalAuthRouter);
  return app;
}

describe('portal password reset', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /forgot-password always returns 200, even for an unknown email', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post('/portal/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(issueResetToken).not.toHaveBeenCalled();
  });

  it('POST /forgot-password issues a token and emails it for a known tenant', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', loginEmail: 'x@y.com' });
    issueResetToken.mockResolvedValue('raw-token');
    const res = await request(buildApp()).post('/portal/forgot-password').send({ email: 'x@y.com' });
    expect(res.status).toBe(200);
    expect(issueResetToken).toHaveBeenCalledWith('TENANT', 't1');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith('x@y.com', expect.stringContaining('raw-token'));
  });

  it('POST /reset-password rejects an invalid/expired token', async () => {
    consumeResetToken.mockResolvedValue(null);
    const res = await request(buildApp()).post('/portal/reset-password').send({ token: 'bad', password: 'newpass123' });
    expect(res.status).toBe(400);
  });

  it('POST /reset-password updates the password on a valid token', async () => {
    consumeResetToken.mockResolvedValue({ actorType: 'TENANT', actorId: 't1' });
    hashPassword.mockResolvedValue('new-hash');
    prisma.tenant.update.mockResolvedValue({});
    const res = await request(buildApp()).post('/portal/reset-password').send({ token: 'good', password: 'newpass123' });
    expect(res.status).toBe(200);
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { passwordHash: 'new-hash' } });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest tests/controllers/portalPasswordReset.test.js`
Expected: FAIL — endpoints not implemented, requests return 404

- [ ] **Step 7: Extend `src/controllers/portalAuthController.js`**

Add these requires at the top:

```js
const { issueResetToken, consumeResetToken } = require('../services/passwordResetService');
const { sendPasswordResetEmail } = require('../services/emailService');
const { hashPassword, verifyPassword } = require('../services/authService');
```

Add these routes before `module.exports`:

```js
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const tenant = await prisma.tenant.findUnique({ where: { loginEmail: email } });
  if (tenant) {
    const token = await issueResetToken('TENANT', tenant.id);
    const resetUrl = `${req.headers.origin || ''}/portal/reset-password?token=${token}`;
    await sendPasswordResetEmail(tenant.loginEmail, resetUrl);
  }
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  const result = await consumeResetToken(token);
  if (!result || result.actorType !== 'TENANT') {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  const passwordHash = await hashPassword(password);
  await prisma.tenant.update({ where: { id: result.actorId }, data: { passwordHash } });
  res.json({ ok: true });
});

router.patch('/change-password', requireTenantSession, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!(await verifyPassword(currentPassword, req.tenant.passwordHash))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.tenant.update({ where: { id: req.tenant.id }, data: { passwordHash } });
  res.json({ ok: true });
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest tests/controllers/portalPasswordReset.test.js`
Expected: PASS

- [ ] **Step 9: Add matching forgot/reset endpoints to `src/controllers/adminAuthController.js`**

Add the same three requires as Step 7 (swap `tenant` for `superAdmin`), and add before `module.exports`:

```js
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const superAdmin = await prisma.superAdmin.findUnique({ where: { email } });
  if (superAdmin) {
    const token = await issueResetToken('SUPER_ADMIN', superAdmin.id);
    const resetUrl = `${req.headers.origin || ''}/admin/reset-password?token=${token}`;
    await sendPasswordResetEmail(superAdmin.email, resetUrl);
  }
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  const result = await consumeResetToken(token);
  if (!result || result.actorType !== 'SUPER_ADMIN') {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  const passwordHash = await hashPassword(password);
  await prisma.superAdmin.update({ where: { id: result.actorId }, data: { passwordHash } });
  res.json({ ok: true });
});
```

- [ ] **Step 10: Run full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 11: Commit**

```bash
git add src/services/passwordResetService.js src/controllers/portalAuthController.js src/controllers/adminAuthController.js tests/services/passwordResetService.test.js tests/controllers/portalPasswordReset.test.js
git commit -m "feat(auth): add self-service password reset for tenants and super-admins"
```

---

## Task 9: Portal session/message/rule routes (reuse existing controllers)

**Files:**
- Modify: `src/routes/portal.js`
- Create: `tests/routes/portal.test.js`

**Interfaces:**
- Consumes: `sessionController.{createSession,getSessionStatus,listMessageLogs}`, `reviewController.{createCorrection,listCorrections,deleteCorrection}` (all pre-existing, unchanged), `requireTenantSession` (Task 5)
- Produces: `GET/POST /api/v1/portal/sessions`, `GET /api/v1/portal/sessions/:sessionId`, `GET /api/v1/portal/messages`, `GET/POST /api/v1/portal/corrections`, `DELETE /api/v1/portal/corrections/:ruleId`

- [ ] **Step 1: Write the failing test**

Create `tests/routes/portal.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  tenant: { findUnique: jest.fn() },
  whatsAppSession: { create: jest.fn(), findFirst: jest.fn() },
  messageLog: { findMany: jest.fn() },
  correctionRule: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
}));
jest.mock('../../src/services/baileysManager', () => ({
  startSession: jest.fn().mockResolvedValue(undefined),
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const prisma = require('../../src/db/prisma');
const portalRoutes = require('../../src/routes/portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use('/api/v1/portal', portalRoutes);
  return app;
}

async function loggedInAgent(app) {
  prisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE' });
  const agent = request.agent(app);
  await agent.post('/api/v1/portal/login-test-helper');
  return agent;
}

describe('portal data routes reuse the existing api-key controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects GET /messages without a session', async () => {
    const res = await request(buildApp()).get('/api/v1/portal/messages');
    expect(res.status).toBe(401);
  });

  it('lists messages for the logged-in tenant', async () => {
    const app = buildApp();
    app.post('/api/v1/portal/login-test-helper', (req, res) => {
      req.session.tenantId = 't1';
      res.json({ ok: true });
    });
    prisma.messageLog.findMany.mockResolvedValue([{ id: 'm1' }]);
    const agent = await loggedInAgent(app);
    const res = await agent.get('/api/v1/portal/messages');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'm1' }]);
    expect(prisma.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/routes/portal.test.js`
Expected: FAIL — `/messages` route not mounted, 404

- [ ] **Step 3: Extend `src/routes/portal.js`**

```js
const express = require('express');
const portalAuthController = require('../controllers/portalAuthController');
const requireTenantSession = require('../middleware/requireTenantSession');
const sessionController = require('../controllers/sessionController');
const reviewController = require('../controllers/reviewController');

const router = express.Router();
router.use('/', portalAuthController);

router.use(requireTenantSession);

router.post('/sessions', sessionController.createSession);
router.get('/sessions/:sessionId', sessionController.getSessionStatus);
router.get('/messages', sessionController.listMessageLogs);
router.get('/corrections', reviewController.listCorrections);
router.post('/corrections', reviewController.createCorrection);
router.delete('/corrections/:ruleId', reviewController.deleteCorrection);

module.exports = router;
```

Note: `router.use(requireTenantSession)` is placed after `router.use('/', portalAuthController)` so `/login`, `/logout`, `/forgot-password`, and `/reset-password` (all defined without the middleware inside `portalAuthController`) stay public, while everything mounted after this line requires a session. `/me` and `/change-password` already carry `requireTenantSession` individually inside `portalAuthController.js` from Tasks 6 and 8, so they work correctly regardless of this router-level `use`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/routes/portal.test.js`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/portal.js tests/routes/portal.test.js
git commit -m "feat(portal): expose sessions/messages/corrections via tenant login"
```

---

## Task 10: Reconnect flow and disconnect-notification email

**Files:**
- Modify: `src/services/baileysManager.js`
- Modify: `src/routes/portal.js`
- Create: `tests/services/baileysManager.reconnect.test.js`

**Interfaces:**
- Consumes: `sendDisconnectAlertEmail` (Task 7)
- Produces: `reconnectSession(tenantId, sessionId) => Promise<void>` (exported from `baileysManager.js`), `POST /api/v1/portal/sessions/:sessionId/reconnect`

- [ ] **Step 1: Write the failing test**

Create `tests/services/baileysManager.reconnect.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  whatsAppSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
}));
jest.mock('@whiskeysockets/baileys', () => {
  const actual = jest.requireActual('@whiskeysockets/baileys');
  return { ...actual, default: jest.fn() };
});

const makeWASocket = require('@whiskeysockets/baileys').default;
const prisma = require('../../src/db/prisma');

describe('reconnectSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('flips the session back to PENDING_QR and starts a new socket', async () => {
    makeWASocket.mockReturnValue({
      ev: { on: jest.fn() },
    });
    const { reconnectSession } = require('../../src/services/baileysManager');
    await reconnectSession('tenant-1', 'session-1');

    expect(prisma.whatsAppSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { status: 'PENDING_QR', qrCode: null },
    });
    expect(makeWASocket).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/services/baileysManager.reconnect.test.js`
Expected: FAIL — `reconnectSession is not a function`

- [ ] **Step 3: Add `reconnectSession` to `src/services/baileysManager.js`**

Add this function above `module.exports`, and add `disconnectNotifiedAt` handling to the existing `connection.update` handler:

```js
async function reconnectSession(tenantId, sessionId) {
  await prisma.whatsAppSession.updateMany({
    where: { id: sessionId },
    data: { status: 'PENDING_QR', qrCode: null },
  });
  await startSession(tenantId, sessionId);
}
```

In the existing `connection.update` handler's `close` branch, replace the `updateMany` call and the logic around it with:

```js
if (connection === 'close') {
  const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
  const loggedOut = statusCode === DisconnectReason.loggedOut;

  const { count } = await prisma.whatsAppSession.updateMany({
    where: { id: sessionId },
    data: { status: loggedOut ? 'LOGGED_OUT' : 'DISCONNECTED' },
  });

  activeSockets.delete(tenantId);

  if (loggedOut) {
    await clearAuthState(redis, tenantId);
    await notifyDisconnectIfNeeded(tenantId, sessionId);
  } else if (count === 0) {
    logger.warn({ tenantId, sessionId }, 'Session record gone, not reconnecting');
  } else {
    logger.warn({ tenantId, sessionId }, 'WhatsApp session dropped, reconnecting');
    await startSession(tenantId, sessionId);
  }
}
```

In the `connection === 'open'` branch, after the existing `prisma.whatsAppSession.updateMany` call, add:

```js
await prisma.whatsAppSession.updateMany({ where: { id: sessionId }, data: { disconnectNotifiedAt: null } });
```

Add this helper function and its import above `module.exports`:

```js
const { sendDisconnectAlertEmail } = require('./emailService');

async function notifyDisconnectIfNeeded(tenantId, sessionId) {
  const session = await prisma.whatsAppSession.findUnique({ where: { id: sessionId } });
  if (!session || session.disconnectNotifiedAt) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.loginEmail) return;

  await sendDisconnectAlertEmail(tenant.loginEmail, tenant.name);
  await prisma.whatsAppSession.update({ where: { id: sessionId }, data: { disconnectNotifiedAt: new Date() } });
}
```

Update the final `module.exports` line to include `reconnectSession`:

```js
module.exports = { startSession, reconnectSession, getSocket, activeSockets, resumeActiveSessions };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/services/baileysManager.reconnect.test.js`
Expected: PASS

- [ ] **Step 5: Add the portal reconnect route**

In `src/routes/portal.js`, add near the other session routes:

```js
router.post('/sessions/:sessionId/reconnect', async (req, res) => {
  const { reconnectSession } = require('../services/baileysManager');
  await reconnectSession(req.tenant.id, req.params.sessionId);
  res.json({ ok: true });
});
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/baileysManager.js src/routes/portal.js tests/services/baileysManager.reconnect.test.js
git commit -m "feat(sessions): add reconnect flow and disconnect email notification"
```

---

## Task 11: Admin tenant management

**Files:**
- Create: `src/controllers/adminTenantController.js`
- Create: `tests/controllers/adminTenantController.test.js`
- Modify: `src/routes/admin.js`

**Interfaces:**
- Consumes: `writeAuditLog` (Task 4), `requireSuperAdmin` (Task 5)
- Produces: `GET /api/v1/admin/tenants`, `POST /api/v1/admin/tenants`, `GET /api/v1/admin/tenants/:id`, `PATCH /api/v1/admin/tenants/:id`, `POST /api/v1/admin/tenants/:id/send-password-reset`

- [ ] **Step 1: Write the failing test**

Create `tests/controllers/adminTenantController.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  tenant: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
}));
jest.mock('../../src/services/auditService', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../src/services/passwordResetService', () => ({ issueResetToken: jest.fn() }));
jest.mock('../../src/services/emailService', () => ({ sendPasswordResetEmail: jest.fn() }));

const prisma = require('../../src/db/prisma');
const { writeAuditLog } = require('../../src/services/auditService');
const { issueResetToken } = require('../../src/services/passwordResetService');
const { sendPasswordResetEmail } = require('../../src/services/emailService');
const {
  listTenants,
  createTenant,
  getTenant,
  updateTenant,
  sendTenantPasswordReset,
} = require('../../src/controllers/adminTenantController');

function mockReqRes(overrides = {}) {
  const req = { superAdmin: { id: 'admin-1' }, params: {}, body: {}, query: {}, headers: {}, ...overrides };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { req, res };
}

describe('adminTenantController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists tenants with pagination', async () => {
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }]);
    const { req, res } = mockReqRes({ query: { limit: '10' } });
    await listTenants(req, res);
    expect(prisma.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
    expect(res.json).toHaveBeenCalledWith([{ id: 't1' }]);
  });

  it('creates a tenant and writes an audit log', async () => {
    prisma.tenant.create.mockResolvedValue({ id: 't1', name: 'Acme' });
    const { req, res } = mockReqRes({ body: { name: 'Acme', rateLimitHours: 24 } });
    await createTenant(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'SUPER_ADMIN', actorId: 'admin-1', action: 'TENANT_CREATED', tenantId: 't1' })
    );
  });

  it('updates a tenant status and writes a before/after audit log', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE' });
    prisma.tenant.update.mockResolvedValue({ id: 't1', status: 'SUSPENDED' });
    const { req, res } = mockReqRes({ params: { id: 't1' }, body: { status: 'SUSPENDED' } });
    await updateTenant(req, res);
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'SUSPENDED' } });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TENANT_UPDATED',
        tenantId: 't1',
        beforeData: { status: 'ACTIVE' },
        afterData: { status: 'SUSPENDED' },
      })
    );
  });

  it('returns 404 when updating a nonexistent tenant', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    const { req, res } = mockReqRes({ params: { id: 'nope' }, body: { status: 'SUSPENDED' } });
    await updateTenant(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('sends a password reset for a tenant and audits it', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', loginEmail: 'x@y.com' });
    issueResetToken.mockResolvedValue('raw-token');
    const { req, res } = mockReqRes({ params: { id: 't1' }, headers: { origin: 'https://app.example.com' } });
    await sendTenantPasswordReset(req, res);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith('x@y.com', expect.stringContaining('raw-token'));
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TENANT_PASSWORD_RESET_TRIGGERED', tenantId: 't1' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/controllers/adminTenantController.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/controllers/adminTenantController.js`**

```js
const prisma = require('../db/prisma');
const { writeAuditLog } = require('../services/auditService');
const { issueResetToken } = require('../services/passwordResetService');
const { sendPasswordResetEmail } = require('../services/emailService');

async function listTenants(req, res) {
  const { limit } = req.query;
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit || '50', 10), 200),
  });
  res.json(tenants);
}

async function createTenant(req, res) {
  const { name, rateLimitHours } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const tenant = await prisma.tenant.create({ data: { name, rateLimitHours: rateLimitHours ?? 24 } });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'TENANT_CREATED',
    targetType: 'Tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    afterData: tenant,
  });
  res.status(201).json(tenant);
}

async function getTenant(req, res) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(tenant);
}

async function updateTenant(req, res) {
  const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Tenant not found' });

  const { name, rateLimitHours, status } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (rateLimitHours !== undefined) data.rateLimitHours = rateLimitHours;
  if (status !== undefined) data.status = status;

  const updated = await prisma.tenant.update({ where: { id: req.params.id }, data });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'TENANT_UPDATED',
    targetType: 'Tenant',
    targetId: existing.id,
    tenantId: existing.id,
    beforeData: existing,
    afterData: updated,
  });
  res.json(updated);
}

async function sendTenantPasswordReset(req, res) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant?.loginEmail) return res.status(400).json({ error: 'Tenant has no login email set' });

  const token = await issueResetToken('TENANT', tenant.id);
  const resetUrl = `${req.headers.origin || ''}/portal/reset-password?token=${token}`;
  await sendPasswordResetEmail(tenant.loginEmail, resetUrl);
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'TENANT_PASSWORD_RESET_TRIGGERED',
    targetType: 'Tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
  });
  res.json({ ok: true });
}

module.exports = { listTenants, createTenant, getTenant, updateTenant, sendTenantPasswordReset };
```

Note: for `updateTenant`, only pass `beforeData`/`afterData` fields relevant to the diff in a real system with many fields — here the whole record is small enough that logging the full before/after tenant object is acceptable and simpler than field-diffing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/controllers/adminTenantController.test.js`
Expected: PASS

- [ ] **Step 5: Wire routes into `src/routes/admin.js`**

```js
const express = require('express');
const adminAuthController = require('../controllers/adminAuthController');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const adminTenantController = require('../controllers/adminTenantController');

const router = express.Router();
router.use('/', adminAuthController);

router.use(requireSuperAdmin);

router.get('/tenants', adminTenantController.listTenants);
router.post('/tenants', adminTenantController.createTenant);
router.get('/tenants/:id', adminTenantController.getTenant);
router.patch('/tenants/:id', adminTenantController.updateTenant);
router.post('/tenants/:id/send-password-reset', adminTenantController.sendTenantPasswordReset);

module.exports = router;
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/controllers/adminTenantController.js src/routes/admin.js tests/controllers/adminTenantController.test.js
git commit -m "feat(admin): add tenant management endpoints with audit logging"
```

---

## Task 12: Admin cross-tenant messages, rules, and sessions

**Files:**
- Create: `src/controllers/adminTenantDataController.js`
- Create: `tests/controllers/adminTenantDataController.test.js`
- Modify: `src/routes/admin.js`

**Interfaces:**
- Consumes: `writeAuditLog` (Task 4), `reconnectSession` (Task 10)
- Produces: `GET /api/v1/admin/tenants/:id/messages`, `GET/POST /api/v1/admin/tenants/:id/corrections`, `DELETE /api/v1/admin/tenants/:id/corrections/:ruleId`, `GET /api/v1/admin/tenants/:id/sessions`, `POST /api/v1/admin/tenants/:id/sessions/:sessionId/reconnect`

- [ ] **Step 1: Write the failing test**

Create `tests/controllers/adminTenantDataController.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  messageLog: { findMany: jest.fn() },
  correctionRule: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  whatsAppSession: { findMany: jest.fn() },
}));
jest.mock('../../src/services/auditService', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../src/services/baileysManager', () => ({ reconnectSession: jest.fn() }));

const prisma = require('../../src/db/prisma');
const { writeAuditLog } = require('../../src/services/auditService');
const { reconnectSession } = require('../../src/services/baileysManager');
const {
  listTenantMessages,
  listTenantCorrections,
  createTenantCorrection,
  deleteTenantCorrection,
  listTenantSessions,
  reconnectTenantSession,
} = require('../../src/controllers/adminTenantDataController');

function mockReqRes(overrides = {}) {
  const req = { superAdmin: { id: 'admin-1' }, params: {}, body: {}, query: {}, ...overrides };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
  return { req, res };
}

describe('adminTenantDataController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists a tenant\'s messages, scoped by tenantId param', async () => {
    prisma.messageLog.findMany.mockResolvedValue([{ id: 'm1' }]);
    const { req, res } = mockReqRes({ params: { id: 't1' } });
    await listTenantMessages(req, res);
    expect(prisma.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) })
    );
    expect(res.json).toHaveBeenCalledWith([{ id: 'm1' }]);
  });

  it('creates a correction rule for a tenant and audits it', async () => {
    prisma.correctionRule.create.mockResolvedValue({ id: 'r1', tenantId: 't1' });
    const { req, res } = mockReqRes({ params: { id: 't1' }, body: { pattern: 'rip', action: 'SKIP_REPLY' } });
    await createTenantCorrection(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CORRECTION_RULE_CREATED', tenantId: 't1', actorType: 'SUPER_ADMIN' })
    );
  });

  it('reconnects a tenant session and audits it', async () => {
    const { req, res } = mockReqRes({ params: { id: 't1', sessionId: 's1' } });
    await reconnectTenantSession(req, res);
    expect(reconnectSession).toHaveBeenCalledWith('t1', 's1');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_RECONNECT_TRIGGERED', tenantId: 't1', targetId: 's1' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/controllers/adminTenantDataController.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/controllers/adminTenantDataController.js`**

```js
const prisma = require('../db/prisma');
const { writeAuditLog } = require('../services/auditService');
const { reconnectSession } = require('../services/baileysManager');

async function listTenantMessages(req, res) {
  const { id: tenantId } = req.params;
  const { status, limit } = req.query;
  const logs = await prisma.messageLog.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit || '50', 10), 200),
  });
  res.json(logs);
}

async function listTenantCorrections(req, res) {
  const rules = await prisma.correctionRule.findMany({ where: { tenantId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json(rules);
}

async function createTenantCorrection(req, res) {
  const { id: tenantId } = req.params;
  const { pattern, isRegex, action, forcedReply, category } = req.body;
  if (!pattern || !action) return res.status(400).json({ error: 'pattern and action are required' });

  const rule = await prisma.correctionRule.create({
    data: { tenantId, pattern, isRegex: isRegex ?? true, action, forcedReply: forcedReply ?? null, category: category ?? null },
  });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'CORRECTION_RULE_CREATED',
    targetType: 'CorrectionRule',
    targetId: rule.id,
    tenantId,
    afterData: rule,
  });
  res.status(201).json(rule);
}

async function deleteTenantCorrection(req, res) {
  const { id: tenantId, ruleId } = req.params;
  const rule = await prisma.correctionRule.findFirst({ where: { id: ruleId, tenantId } });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  await prisma.correctionRule.update({ where: { id: ruleId }, data: { active: false } });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'CORRECTION_RULE_DELETED',
    targetType: 'CorrectionRule',
    targetId: ruleId,
    tenantId,
    beforeData: rule,
  });
  res.status(204).send();
}

async function listTenantSessions(req, res) {
  const sessions = await prisma.whatsAppSession.findMany({ where: { tenantId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json(sessions);
}

async function reconnectTenantSession(req, res) {
  const { id: tenantId, sessionId } = req.params;
  await reconnectSession(tenantId, sessionId);
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'SESSION_RECONNECT_TRIGGERED',
    targetType: 'WhatsAppSession',
    targetId: sessionId,
    tenantId,
  });
  res.json({ ok: true });
}

module.exports = {
  listTenantMessages,
  listTenantCorrections,
  createTenantCorrection,
  deleteTenantCorrection,
  listTenantSessions,
  reconnectTenantSession,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/controllers/adminTenantDataController.test.js`
Expected: PASS

- [ ] **Step 5: Wire routes into `src/routes/admin.js`**

Add below the existing tenant routes from Task 11:

```js
const adminTenantDataController = require('../controllers/adminTenantDataController');

router.get('/tenants/:id/messages', adminTenantDataController.listTenantMessages);
router.get('/tenants/:id/corrections', adminTenantDataController.listTenantCorrections);
router.post('/tenants/:id/corrections', adminTenantDataController.createTenantCorrection);
router.delete('/tenants/:id/corrections/:ruleId', adminTenantDataController.deleteTenantCorrection);
router.get('/tenants/:id/sessions', adminTenantDataController.listTenantSessions);
router.post('/tenants/:id/sessions/:sessionId/reconnect', adminTenantDataController.reconnectTenantSession);
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/controllers/adminTenantDataController.js src/routes/admin.js tests/controllers/adminTenantDataController.test.js
git commit -m "feat(admin): add cross-tenant message, rule, and session management"
```

---

## Task 13: Audit log listing and system health endpoints

**Files:**
- Create: `src/controllers/adminAuditController.js`
- Create: `src/controllers/adminHealthController.js`
- Create: `tests/controllers/adminAuditController.test.js`
- Create: `tests/controllers/adminHealthController.test.js`
- Modify: `src/routes/admin.js`

**Interfaces:**
- Consumes: `messageQueue`, `replyQueue` (from `src/queues/*`, existing BullMQ `Queue` instances)
- Produces: `GET /api/v1/admin/audit-logs`, `GET /api/v1/admin/system/health`

- [ ] **Step 1: Write the failing test for audit logs**

Create `tests/controllers/adminAuditController.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  auditLog: { findMany: jest.fn() },
}));

const prisma = require('../../src/db/prisma');
const { listAuditLogs } = require('../../src/controllers/adminAuditController');

describe('listAuditLogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filters by tenantId, actorType, and action when provided', async () => {
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'a1' }]);
    const req = { query: { tenantId: 't1', actorType: 'SUPER_ADMIN', action: 'TENANT_CREATED', limit: '10' } };
    const res = { json: jest.fn() };
    await listAuditLogs(req, res);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', actorType: 'SUPER_ADMIN', action: 'TENANT_CREATED' },
        take: 10,
      })
    );
    expect(res.json).toHaveBeenCalledWith([{ id: 'a1' }]);
  });

  it('applies no filters when none are given', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    const req = { query: {} };
    const res = { json: jest.fn() };
    await listAuditLogs(req, res);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/controllers/adminAuditController.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/controllers/adminAuditController.js`**

```js
const prisma = require('../db/prisma');

async function listAuditLogs(req, res) {
  const { tenantId, actorType, action, limit } = req.query;
  const where = {};
  if (tenantId) where.tenantId = tenantId;
  if (actorType) where.actorType = actorType;
  if (action) where.action = action;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit || '50', 10), 200),
  });
  res.json(logs);
}

module.exports = { listAuditLogs };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/controllers/adminAuditController.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for system health**

Create `tests/controllers/adminHealthController.test.js`:

```js
jest.mock('../../src/queues/messageQueue', () => ({
  messageQueue: { getJobCounts: jest.fn() },
}));
jest.mock('../../src/queues/replyQueue', () => ({
  replyQueue: { getJobCounts: jest.fn() },
}));

const { messageQueue } = require('../../src/queues/messageQueue');
const { replyQueue } = require('../../src/queues/replyQueue');
const { getSystemHealth } = require('../../src/controllers/adminHealthController');

global.fetch = jest.fn();

describe('getSystemHealth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports queue counts and ollama reachability', async () => {
    messageQueue.getJobCounts.mockResolvedValue({ waiting: 1, active: 0, failed: 0 });
    replyQueue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, failed: 0 });
    global.fetch.mockResolvedValue({ ok: true });

    const req = {};
    const res = { json: jest.fn() };
    await getSystemHealth(req, res);

    expect(res.json).toHaveBeenCalledWith({
      queues: {
        incomingMessages: { waiting: 1, active: 0, failed: 0 },
        outgoingReplies: { waiting: 0, active: 0, failed: 0 },
      },
      ollama: { reachable: true },
    });
  });

  it('reports ollama as unreachable when the health request fails', async () => {
    messageQueue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, failed: 0 });
    replyQueue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, failed: 0 });
    global.fetch.mockRejectedValue(new Error('connection refused'));

    const req = {};
    const res = { json: jest.fn() };
    await getSystemHealth(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ollama: { reachable: false } })
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest tests/controllers/adminHealthController.test.js`
Expected: FAIL — module not found

- [ ] **Step 7: Implement `src/controllers/adminHealthController.js`**

```js
const { messageQueue } = require('../queues/messageQueue');
const { replyQueue } = require('../queues/replyQueue');
const { ollama } = require('../config/env');

async function getSystemHealth(req, res) {
  const [incomingCounts, replyCounts] = await Promise.all([
    messageQueue.getJobCounts('waiting', 'active', 'failed'),
    replyQueue.getJobCounts('waiting', 'active', 'failed'),
  ]);

  let ollamaReachable = false;
  try {
    const response = await fetch(`${ollama.baseUrl}/api/tags`);
    ollamaReachable = response.ok;
  } catch {
    ollamaReachable = false;
  }

  res.json({
    queues: {
      incomingMessages: { waiting: incomingCounts.waiting, active: incomingCounts.active, failed: incomingCounts.failed },
      outgoingReplies: { waiting: replyCounts.waiting, active: replyCounts.active, failed: replyCounts.failed },
    },
    ollama: { reachable: ollamaReachable },
  });
}

module.exports = { getSystemHealth };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest tests/controllers/adminHealthController.test.js`
Expected: PASS

- [ ] **Step 9: Wire routes into `src/routes/admin.js`**

```js
const adminAuditController = require('../controllers/adminAuditController');
const adminHealthController = require('../controllers/adminHealthController');

router.get('/audit-logs', adminAuditController.listAuditLogs);
router.get('/system/health', adminHealthController.getSystemHealth);
```

- [ ] **Step 10: Run full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 11: Commit**

```bash
git add src/controllers/adminAuditController.js src/controllers/adminHealthController.js src/routes/admin.js tests/controllers/adminAuditController.test.js tests/controllers/adminHealthController.test.js
git commit -m "feat(admin): add audit log listing and system health endpoints"
```

---

## Task 14: Super-admin management endpoints

**Files:**
- Create: `src/controllers/adminSuperAdminController.js`
- Create: `tests/controllers/adminSuperAdminController.test.js`
- Modify: `src/routes/admin.js`

**Interfaces:**
- Consumes: `hashPassword` (Task 3), `writeAuditLog` (Task 4)
- Produces: `GET /api/v1/admin/super-admins`, `POST /api/v1/admin/super-admins`

- [ ] **Step 1: Write the failing test**

Create `tests/controllers/adminSuperAdminController.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  superAdmin: { findMany: jest.fn(), create: jest.fn() },
}));
jest.mock('../../src/services/authService', () => ({ hashPassword: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ writeAuditLog: jest.fn() }));

const prisma = require('../../src/db/prisma');
const { hashPassword } = require('../../src/services/authService');
const { writeAuditLog } = require('../../src/services/auditService');
const { listSuperAdmins, createSuperAdmin } = require('../../src/controllers/adminSuperAdminController');

describe('adminSuperAdminController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists super admins without exposing passwordHash', async () => {
    prisma.superAdmin.findMany.mockResolvedValue([{ id: 'a1', email: 'a@b.com', name: 'Ada' }]);
    const req = {};
    const res = { json: jest.fn() };
    await listSuperAdmins(req, res);
    expect(prisma.superAdmin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ passwordHash: false }) })
    );
    expect(res.json).toHaveBeenCalledWith([{ id: 'a1', email: 'a@b.com', name: 'Ada' }]);
  });

  it('creates a super admin with a hashed password and audits it', async () => {
    hashPassword.mockResolvedValue('hash123');
    prisma.superAdmin.create.mockResolvedValue({ id: 'a2', email: 'new@b.com', name: 'New' });
    const req = { superAdmin: { id: 'admin-1' }, body: { email: 'new@b.com', password: 'pw', name: 'New' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createSuperAdmin(req, res);
    expect(prisma.superAdmin.create).toHaveBeenCalledWith({
      data: { email: 'new@b.com', passwordHash: 'hash123', name: 'New' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUPER_ADMIN_CREATED', actorId: 'admin-1' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/controllers/adminSuperAdminController.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/controllers/adminSuperAdminController.js`**

```js
const prisma = require('../db/prisma');
const { hashPassword } = require('../services/authService');
const { writeAuditLog } = require('../services/auditService');

async function listSuperAdmins(req, res) {
  const admins = await prisma.superAdmin.findMany({
    select: { id: true, email: true, name: true, createdAt: true, passwordHash: false },
  });
  res.json(admins);
}

async function createSuperAdmin(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const passwordHash = await hashPassword(password);
  const admin = await prisma.superAdmin.create({ data: { email, passwordHash, name } });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'SUPER_ADMIN_CREATED',
    targetType: 'SuperAdmin',
    targetId: admin.id,
  });
  res.status(201).json({ id: admin.id, email: admin.email, name: admin.name });
}

module.exports = { listSuperAdmins, createSuperAdmin };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/controllers/adminSuperAdminController.test.js`
Expected: PASS

- [ ] **Step 5: Wire routes into `src/routes/admin.js`**

```js
const adminSuperAdminController = require('../controllers/adminSuperAdminController');

router.get('/super-admins', adminSuperAdminController.listSuperAdmins);
router.post('/super-admins', adminSuperAdminController.createSuperAdmin);
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/controllers/adminSuperAdminController.js src/routes/admin.js tests/controllers/adminSuperAdminController.test.js
git commit -m "feat(admin): add super-admin account management"
```

---

## Task 15: First super-admin CLI script

**Files:**
- Create: `scripts/create-super-admin.js`
- Modify: `package.json` (add `"create-admin": "node scripts/create-super-admin.js"` script)

**Interfaces:**
- Consumes: `hashPassword` (Task 3), `prisma.superAdmin.create`

- [ ] **Step 1: Implement `scripts/create-super-admin.js`**

```js
require('../src/config/env');
const prisma = require('../src/db/prisma');
const { hashPassword } = require('../src/services/authService');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const { email, password, name } = parseArgs();
  if (!email || !password) {
    console.error('Usage: node scripts/create-super-admin.js --email=you@example.com --password=... [--name="Your Name"]');
    process.exit(1);
  }

  const existing = await prisma.superAdmin.findUnique({ where: { email } });
  if (existing) {
    console.error(`A super-admin with email ${email} already exists.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.superAdmin.create({ data: { email, passwordHash, name: name || null } });
  console.log(`Created super-admin ${admin.email} (id: ${admin.id})`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`, under `"scripts"`, add:

```json
"create-admin": "node scripts/create-super-admin.js"
```

- [ ] **Step 3: Manually verify against the dev database**

Run: `npm run create-admin -- --email=you@example.com --password=change-me-now --name="Your Name"`
Expected: `Created super-admin you@example.com (id: ...)`

- [ ] **Step 4: Commit**

```bash
git add scripts/create-super-admin.js package.json
git commit -m "feat(admin): add CLI script to create the first super-admin"
```

---

## Task 16: Frontend scaffold — Vite, Tailwind, primitives, API client

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/tailwind.config.js`, `web/postcss.config.js`
- Create: `web/src/main.tsx`, `web/src/index.css`
- Create: `web/src/lib/apiClient.ts`
- Create: `web/src/components/ui/Button.tsx`, `web/src/components/ui/Input.tsx`, `web/src/components/ui/Card.tsx`, `web/src/components/ui/Table.tsx`

**Interfaces:**
- Produces: `apiFetch<T>(path: string, options?: RequestInit) => Promise<T>` — thin fetch wrapper, `credentials: 'include'`, throws on non-2xx with the response body's `error` field as the message.

- [ ] **Step 1: Scaffold the Vite project**

Run: `npm create vite@latest web -- --template react-ts`
Then: `cd web && npm install && npm install -D tailwindcss postcss autoprefixer @tanstack/react-query react-router-dom && npx tailwindcss init -p`

- [ ] **Step 2: Configure Tailwind for dark-by-default**

Replace `web/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d1117',
        surface: '#161b22',
        border: '#30363d',
        text: '#c9d1d9',
        muted: '#8b949e',
        accent: '#58a6ff',
        success: '#3fb950',
        danger: '#f85149',
      },
    },
  },
  plugins: [],
};
```

Replace `web/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html {
  @apply dark;
}

body {
  @apply bg-bg text-text;
}
```

- [ ] **Step 3: Implement the API client**

Create `web/src/lib/apiClient.ts`:

```ts
const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // response had no JSON body
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
```

- [ ] **Step 4: Implement primitive components**

Create `web/src/components/ui/Button.tsx`:

```tsx
import { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost' };

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  const base = 'px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-accent text-white hover:opacity-90',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'bg-transparent border border-border text-text hover:bg-surface',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
```

Create `web/src/components/ui/Input.tsx`:

```tsx
import { InputHTMLAttributes } from 'react';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-1.5 rounded-md bg-surface border border-border text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent ${props.className ?? ''}`}
    />
  );
}
```

Create `web/src/components/ui/Card.tsx`:

```tsx
import { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-surface border border-border rounded-lg p-4 ${className}`}>{children}</div>;
}
```

Create `web/src/components/ui/Table.tsx`:

```tsx
import { ReactNode } from 'react';

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full text-sm text-left">{children}</table>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 bg-surface border-b border-border text-muted font-medium">{children}</th>;
}

export function Td({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 border-b border-border">{children}</td>;
}
```

- [ ] **Step 5: Verify the scaffold builds**

Run: `cd web && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): scaffold Vite/React/TypeScript app with Tailwind and UI primitives"
```

---

## Task 17: Frontend routing, auth context, and login pages

**Files:**
- Create: `web/src/lib/authContext.tsx`
- Create: `web/src/pages/portal/PortalLogin.tsx`
- Create: `web/src/pages/admin/AdminLogin.tsx`
- Create: `web/src/App.tsx` (replaces Vite's default)
- Modify: `web/src/main.tsx`

**Interfaces:**
- Produces: `usePortalAuth()`, `useAdminAuth()` hooks (each exposing `{ isAuthenticated, isLoading, login, logout }`); routes `/portal/login`, `/admin/login`, plus guarded placeholders `/portal` and `/admin` that redirect to their login when unauthenticated.

- [ ] **Step 1: Implement the auth context**

Create `web/src/lib/authContext.tsx`:

```tsx
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './apiClient';

type Role = 'portal' | 'admin';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function useAuth(role: Role): AuthState {
  const queryClient = useQueryClient();
  const meKey = [role, 'me'];

  const { data, isLoading } = useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await apiFetch(`/${role}/me`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });

  const login = useCallback(
    async (email: string, password: string) => {
      await apiFetch(`/${role}/login`, { method: 'POST', body: JSON.stringify({ email, password }) });
      await queryClient.invalidateQueries({ queryKey: meKey });
    },
    [role, queryClient]
  );

  const logout = useCallback(async () => {
    await apiFetch(`/${role}/logout`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: meKey });
  }, [role, queryClient]);

  return { isAuthenticated: Boolean(data), isLoading, login, logout };
}

const PortalAuthContext = createContext<AuthState | null>(null);
const AdminAuthContext = createContext<AuthState | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth('portal');
  return <PortalAuthContext.Provider value={auth}>{children}</PortalAuthContext.Provider>;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth('admin');
  return <AdminAuthContext.Provider value={auth}>{children}</AdminAuthContext.Provider>;
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used within PortalAuthProvider');
  return ctx;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Implement the login pages**

Create `web/src/pages/portal/PortalLogin.tsx`:

```tsx
import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../../lib/authContext';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export function PortalLogin() {
  const { login } = usePortalAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/portal');
    } catch {
      setError('Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-4">Tenant Portal Login</h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-danger text-sm">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Logging in...' : 'Log in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

Create `web/src/pages/admin/AdminLogin.tsx` (identical structure, targeting admin auth):

```tsx
import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../../lib/authContext';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export function AdminLogin() {
  const { login } = useAdminAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/admin');
    } catch {
      setError('Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-4">Super-Admin Login</h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-danger text-sm">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Logging in...' : 'Log in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Implement `App.tsx` with route guards**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalAuthProvider, AdminAuthProvider, usePortalAuth, useAdminAuth } from './lib/authContext';
import { PortalLogin } from './pages/portal/PortalLogin';
import { AdminLogin } from './pages/admin/AdminLogin';

const queryClient = new QueryClient();

function PortalGuard({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isLoading } = usePortalAuth();
  if (isLoading) return null;
  return isAuthenticated ? children : <Navigate to="/portal/login" replace />;
}

function AdminGuard({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isLoading } = useAdminAuth();
  if (isLoading) return null;
  return isAuthenticated ? children : <Navigate to="/admin/login" replace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PortalAuthProvider>
        <AdminAuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/portal/login" replace />} />
              <Route path="/portal/login" element={<PortalLogin />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route
                path="/portal/*"
                element={
                  <PortalGuard>
                    <div>Portal dashboard placeholder</div>
                  </PortalGuard>
                }
              />
              <Route
                path="/admin/*"
                element={
                  <AdminGuard>
                    <div>Admin dashboard placeholder</div>
                  </AdminGuard>
                }
              />
            </Routes>
          </BrowserRouter>
        </AdminAuthProvider>
      </PortalAuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Update `web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 5: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): add auth context, login pages, and route guards"
```

---

## Task 18: Portal dashboard — sessions, QR display, reconnect, messages, corrections

**Files:**
- Create: `web/src/pages/portal/PortalDashboard.tsx`
- Create: `web/src/pages/portal/SessionsPanel.tsx`
- Create: `web/src/pages/portal/MessagesPanel.tsx`
- Create: `web/src/pages/portal/CorrectionsPanel.tsx`
- Modify: `web/src/App.tsx` (replace the portal placeholder route)

**Interfaces:**
- Consumes: `apiFetch` (Task 16), portal API endpoints from Tasks 9–10

- [ ] **Step 1: Implement `SessionsPanel.tsx`**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface Session {
  sessionId: string;
  status: string;
  phoneNumber: string | null;
  qrCode: string | null;
}

export function SessionsPanel() {
  const queryClient = useQueryClient();

  const { data: sessions } = useQuery<Session[]>({
    queryKey: ['portal', 'sessions'],
    queryFn: () => apiFetch('/portal/sessions'),
    refetchInterval: 4000,
  });

  const createSession = useMutation({
    mutationFn: () => apiFetch('/portal/sessions', { method: 'POST', body: JSON.stringify({ label: 'Main Line' }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'sessions'] }),
  });

  const reconnect = useMutation({
    mutationFn: (sessionId: string) => apiFetch(`/portal/sessions/${sessionId}/reconnect`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'sessions'] }),
  });

  return (
    <Card>
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">WhatsApp Session</h2>
        <Button onClick={() => createSession.mutate()} disabled={createSession.isPending}>
          New Session
        </Button>
      </div>
      {(sessions ?? []).map((session) => (
        <div key={session.sessionId} className="border-t border-border pt-3 mt-3 first:border-0 first:pt-0 first:mt-0">
          <p className="text-sm">
            Status: <span className="text-accent">{session.status}</span>
            {session.phoneNumber && <span className="text-muted"> ({session.phoneNumber})</span>}
          </p>
          {session.qrCode && <img src={session.qrCode} alt="Scan to link WhatsApp" className="w-48 h-48 mt-2" />}
          {session.status === 'LOGGED_OUT' && (
            <Button variant="ghost" className="mt-2" onClick={() => reconnect.mutate(session.sessionId)}>
              Reconnect device
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}
```

Note: this queries `GET /portal/sessions` (list), but Task 9 only implemented `GET /portal/sessions/:sessionId` (single). Before writing this task's test/verification step, add a `listSessions` handler:

In `src/controllers/sessionController.js`, add:

```js
async function listSessions(req, res) {
  const sessions = await prisma.whatsAppSession.findMany({ where: { tenantId: req.tenant.id }, orderBy: { createdAt: 'desc' } });
  res.json(
    sessions.map((s) => ({
      sessionId: s.id,
      status: s.status,
      phoneNumber: s.phoneNumber,
      qrCode: s.status === 'PENDING_QR' ? s.qrCode : null,
    }))
  );
}
```

Add `listSessions` to the `module.exports` of `sessionController.js`, and in `src/routes/portal.js` add above the existing `sessions/:sessionId` route:

```js
router.get('/sessions', sessionController.listSessions);
```

- [ ] **Step 2: Write the failing test for `listSessions`**

Create `tests/controllers/sessionController.listSessions.test.js`:

```js
jest.mock('../../src/db/prisma', () => ({
  whatsAppSession: { findMany: jest.fn() },
}));

const prisma = require('../../src/db/prisma');
const { listSessions } = require('../../src/controllers/sessionController');

describe('listSessions', () => {
  it('maps sessions to id/status/phoneNumber/qrCode, hiding qrCode unless PENDING_QR', async () => {
    prisma.whatsAppSession.findMany.mockResolvedValue([
      { id: 's1', status: 'CONNECTED', phoneNumber: '123', qrCode: 'data:old' },
      { id: 's2', status: 'PENDING_QR', phoneNumber: null, qrCode: 'data:new' },
    ]);
    const req = { tenant: { id: 't1' } };
    const res = { json: jest.fn() };
    await listSessions(req, res);
    expect(res.json).toHaveBeenCalledWith([
      { sessionId: 's1', status: 'CONNECTED', phoneNumber: '123', qrCode: null },
      { sessionId: 's2', status: 'PENDING_QR', phoneNumber: null, qrCode: 'data:new' },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then implement, then verify it passes**

Run: `npx jest tests/controllers/sessionController.listSessions.test.js` → FAIL, add the code from Step 1 to `sessionController.js` and `routes/portal.js` → Run again → PASS.

- [ ] **Step 4: Implement `MessagesPanel.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Table, Th, Td } from '../../components/ui/Table';

interface MessageLog {
  id: string;
  remoteJid: string;
  status: string;
  detectedLanguage: string | null;
  suggestedReply: string | null;
  createdAt: string;
}

export function MessagesPanel() {
  const { data: messages } = useQuery<MessageLog[]>({
    queryKey: ['portal', 'messages'],
    queryFn: () => apiFetch('/portal/messages'),
  });

  return (
    <Card>
      <h2 className="font-semibold mb-3">Recent Messages</h2>
      <Table>
        <thead>
          <tr>
            <Th>From</Th>
            <Th>Status</Th>
            <Th>Language</Th>
            <Th>Reply</Th>
            <Th>Time</Th>
          </tr>
        </thead>
        <tbody>
          {(messages ?? []).map((m) => (
            <tr key={m.id}>
              <Td>{m.remoteJid}</Td>
              <Td>{m.status}</Td>
              <Td>{m.detectedLanguage ?? '-'}</Td>
              <Td>{m.suggestedReply ?? '-'}</Td>
              <Td>{new Date(m.createdAt).toLocaleString()}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
```

- [ ] **Step 5: Implement `CorrectionsPanel.tsx`**

```tsx
import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Table, Th, Td } from '../../components/ui/Table';

interface CorrectionRule {
  id: string;
  pattern: string;
  action: string;
  category: string | null;
}

export function CorrectionsPanel() {
  const queryClient = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState('SKIP_REPLY');

  const { data: rules } = useQuery<CorrectionRule[]>({
    queryKey: ['portal', 'corrections'],
    queryFn: () => apiFetch('/portal/corrections'),
  });

  const createRule = useMutation({
    mutationFn: () => apiFetch('/portal/corrections', { method: 'POST', body: JSON.stringify({ pattern, isRegex: true, action }) }),
    onSuccess: () => {
      setPattern('');
      queryClient.invalidateQueries({ queryKey: ['portal', 'corrections'] });
    },
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => apiFetch(`/portal/corrections/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'corrections'] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createRule.mutate();
  }

  return (
    <Card>
      <h2 className="font-semibold mb-3">Correction Rules</h2>
      <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
        <Input placeholder="Pattern (regex)" value={pattern} onChange={(e) => setPattern(e.target.value)} required />
        <select value={action} onChange={(e) => setAction(e.target.value)} className="bg-surface border border-border rounded-md px-2 text-sm">
          <option value="SKIP_REPLY">SKIP_REPLY</option>
          <option value="FORCE_GREETING">FORCE_GREETING</option>
          <option value="FORCE_CATEGORY">FORCE_CATEGORY</option>
        </select>
        <Button type="submit">Add</Button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Pattern</Th>
            <Th>Action</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {(rules ?? []).map((rule) => (
            <tr key={rule.id}>
              <Td>{rule.pattern}</Td>
              <Td>{rule.action}</Td>
              <Td>
                <Button variant="danger" onClick={() => deleteRule.mutate(rule.id)}>
                  Delete
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
```

- [ ] **Step 6: Implement `PortalDashboard.tsx`**

```tsx
import { usePortalAuth } from '../../lib/authContext';
import { Button } from '../../components/ui/Button';
import { SessionsPanel } from './SessionsPanel';
import { MessagesPanel } from './MessagesPanel';
import { CorrectionsPanel } from './CorrectionsPanel';

export function PortalDashboard() {
  const { logout } = usePortalAuth();

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Your WhatsApp Assistant</h1>
        <Button variant="ghost" onClick={() => logout()}>
          Log out
        </Button>
      </div>
      <SessionsPanel />
      <MessagesPanel />
      <CorrectionsPanel />
    </div>
  );
}
```

- [ ] **Step 7: Wire `PortalDashboard` into `App.tsx`**

Replace the `/portal/*` route's placeholder `<div>Portal dashboard placeholder</div>` with `<PortalDashboard />`, and add the import: `import { PortalDashboard } from './pages/portal/PortalDashboard';`

- [ ] **Step 8: Run backend tests and frontend build**

Run: `npm test` (backend) and `cd web && npm run build` (frontend)
Expected: both succeed

- [ ] **Step 9: Commit**

```bash
git add src/controllers/sessionController.js src/routes/portal.js tests/controllers/sessionController.listSessions.test.js web
git commit -m "feat(web): add tenant portal dashboard with sessions, messages, and corrections"
```

---

## Task 19: Admin dashboard — tenant list, detail, audit logs, system health

**Files:**
- Create: `web/src/pages/admin/AdminDashboard.tsx`
- Create: `web/src/pages/admin/TenantList.tsx`
- Create: `web/src/pages/admin/TenantDetail.tsx`
- Create: `web/src/pages/admin/AuditLogPage.tsx`
- Create: `web/src/pages/admin/SystemHealthPage.tsx`
- Modify: `web/src/App.tsx` (replace the admin placeholder route with nested routes)

**Interfaces:**
- Consumes: `apiFetch` (Task 16), admin API endpoints from Tasks 11–14

- [ ] **Step 1: Implement `TenantList.tsx`**

```tsx
import { useState, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Table, Th, Td } from '../../components/ui/Table';

interface Tenant {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  loginEmail: string | null;
}

export function TenantList() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ['admin', 'tenants'],
    queryFn: () => apiFetch('/admin/tenants'),
  });

  const createTenant = useMutation({
    mutationFn: () => apiFetch('/admin/tenants', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createTenant.mutate();
  }

  return (
    <Card>
      <h2 className="font-semibold mb-3">Tenants</h2>
      <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
        <Input placeholder="New tenant name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit">Create</Button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Login Email</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {(tenants ?? []).map((tenant) => (
            <tr key={tenant.id}>
              <Td>
                <Link to={`/admin/tenants/${tenant.id}`} className="text-accent">
                  {tenant.name}
                </Link>
              </Td>
              <Td>{tenant.loginEmail ?? '-'}</Td>
              <Td>
                <span className={tenant.status === 'ACTIVE' ? 'text-success' : 'text-danger'}>{tenant.status}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
```

- [ ] **Step 2: Implement `TenantDetail.tsx`**

```tsx
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Table, Th, Td } from '../../components/ui/Table';

interface Tenant {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  loginEmail: string | null;
}

interface WhatsAppSession {
  id: string;
  status: string;
  phoneNumber: string | null;
}

export function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ['admin', 'tenants', id],
    queryFn: () => apiFetch(`/admin/tenants/${id}`),
  });

  const { data: sessions } = useQuery<WhatsAppSession[]>({
    queryKey: ['admin', 'tenants', id, 'sessions'],
    queryFn: () => apiFetch(`/admin/tenants/${id}/sessions`),
    refetchInterval: 5000,
  });

  const toggleStatus = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: tenant?.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id] }),
  });

  const sendReset = useMutation({
    mutationFn: () => apiFetch(`/admin/tenants/${id}/send-password-reset`, { method: 'POST' }),
  });

  const reconnect = useMutation({
    mutationFn: (sessionId: string) => apiFetch(`/admin/tenants/${id}/sessions/${sessionId}/reconnect`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id, 'sessions'] }),
  });

  if (!tenant) return null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <h2 className="font-semibold">{tenant.name}</h2>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => sendReset.mutate()}>
              Send password reset
            </Button>
            <Button variant={tenant.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => toggleStatus.mutate()}>
              {tenant.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
            </Button>
          </div>
        </div>
        <p className="text-muted text-sm mt-1">{tenant.loginEmail ?? 'No login email set'}</p>
      </Card>

      <Card>
        <h3 className="font-semibold mb-3">Sessions</h3>
        <Table>
          <thead>
            <tr>
              <Th>Status</Th>
              <Th>Phone</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(sessions ?? []).map((s) => (
              <tr key={s.id}>
                <Td>{s.status}</Td>
                <Td>{s.phoneNumber ?? '-'}</Td>
                <Td>
                  {s.status === 'LOGGED_OUT' && (
                    <Button variant="ghost" onClick={() => reconnect.mutate(s.id)}>
                      Reconnect
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Implement `AuditLogPage.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Table, Th, Td } from '../../components/ui/Table';

interface AuditLog {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
}

export function AuditLogPage() {
  const { data: logs } = useQuery<AuditLog[]>({
    queryKey: ['admin', 'audit-logs'],
    queryFn: () => apiFetch('/admin/audit-logs'),
  });

  return (
    <Card>
      <h2 className="font-semibold mb-3">Audit Log</h2>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Actor</Th>
            <Th>Action</Th>
            <Th>Target</Th>
          </tr>
        </thead>
        <tbody>
          {(logs ?? []).map((log) => (
            <tr key={log.id}>
              <Td>{new Date(log.createdAt).toLocaleString()}</Td>
              <Td>
                {log.actorType} ({log.actorId})
              </Td>
              <Td>{log.action}</Td>
              <Td>
                {log.targetType} {log.targetId}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
```

- [ ] **Step 4: Implement `SystemHealthPage.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';

interface SystemHealth {
  queues: {
    incomingMessages: { waiting: number; active: number; failed: number };
    outgoingReplies: { waiting: number; active: number; failed: number };
  };
  ollama: { reachable: boolean };
}

export function SystemHealthPage() {
  const { data } = useQuery<SystemHealth>({
    queryKey: ['admin', 'system', 'health'],
    queryFn: () => apiFetch('/admin/system/health'),
    refetchInterval: 5000,
  });

  if (!data) return null;

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <p className="text-muted text-sm">Incoming Queue</p>
        <p className="text-lg">{data.queues.incomingMessages.waiting} waiting</p>
      </Card>
      <Card>
        <p className="text-muted text-sm">Reply Queue</p>
        <p className="text-lg">{data.queues.outgoingReplies.waiting} waiting</p>
      </Card>
      <Card>
        <p className="text-muted text-sm">Ollama</p>
        <p className={data.ollama.reachable ? 'text-success' : 'text-danger'}>
          {data.ollama.reachable ? 'Reachable' : 'Unreachable'}
        </p>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Implement `AdminDashboard.tsx`** with nested routes and a nav

```tsx
import { NavLink, Routes, Route } from 'react-router-dom';
import { useAdminAuth } from '../../lib/authContext';
import { Button } from '../../components/ui/Button';
import { TenantList } from './TenantList';
import { TenantDetail } from './TenantDetail';
import { AuditLogPage } from './AuditLogPage';
import { SystemHealthPage } from './SystemHealthPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'text-accent' : 'text-muted hover:text-text');

export function AdminDashboard() {
  const { logout } = useAdminAuth();

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <nav className="flex gap-4 text-sm">
          <NavLink to="/admin/tenants" className={navLinkClass}>
            Tenants
          </NavLink>
          <NavLink to="/admin/audit-logs" className={navLinkClass}>
            Audit Log
          </NavLink>
          <NavLink to="/admin/system" className={navLinkClass}>
            System Health
          </NavLink>
        </nav>
        <Button variant="ghost" onClick={() => logout()}>
          Log out
        </Button>
      </div>
      <Routes>
        <Route index element={<TenantList />} />
        <Route path="tenants" element={<TenantList />} />
        <Route path="tenants/:id" element={<TenantDetail />} />
        <Route path="audit-logs" element={<AuditLogPage />} />
        <Route path="system" element={<SystemHealthPage />} />
      </Routes>
    </div>
  );
}
```

- [ ] **Step 6: Wire into `App.tsx`**

Replace the `/admin/*` route's placeholder with `<AdminDashboard />` (note the route path must be `/admin/*` so the nested `<Routes>` inside `AdminDashboard` can match sub-paths), and add the import: `import { AdminDashboard } from './pages/admin/AdminDashboard';`

- [ ] **Step 7: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add web
git commit -m "feat(web): add admin dashboard with tenant management, audit log, and system health"
```

---

## Task 20: Deployment — web Dockerfile, nginx config, docker-compose

**Files:**
- Create: `web/Dockerfile`
- Create: `web/nginx.conf`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces: `web` Docker service serving the built SPA on port `8080`, proxying `/api/*` to `app:3000`

- [ ] **Step 1: Create `web/nginx.conf`**

```nginx
server {
  listen 80;

  location /api/ {
    proxy_pass http://app:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location / {
    root /usr/share/nginx/html;
    try_files $uri /index.html;
  }
}
```

- [ ] **Step 2: Create `web/Dockerfile`**

```dockerfile
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 3: Add the `web` service to `docker-compose.yml`**

Add this service (after `app`):

```yaml
  web:
    build: ./web
    restart: unless-stopped
    depends_on:
      - app
    ports:
      - "8080:80"
```

Add the new env vars to `app`'s `environment` block in `docker-compose.yml`:

```yaml
      SESSION_SECRET: ${SESSION_SECRET}
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
      EMAIL_FROM: ${EMAIL_FROM:-no-reply@localhost}
```

- [ ] **Step 4: Verify the full stack builds and starts**

Run: `docker compose up -d --build`
Expected: all 5 services (`postgres`, `redis`, `ollama`, `app`, `web`) come up; `curl http://localhost:8080` returns the SPA's HTML; `curl http://localhost:8080/api/v1/health`-equivalent (actually `/health` is not under `/api`, so verify via `curl http://localhost:3000/health` directly, and `curl -X POST http://localhost:8080/api/v1/portal/login -H "Content-Type: application/json" -d '{"email":"x","password":"y"}'` returns a 401 JSON response proxied correctly through nginx).

- [ ] **Step 5: Commit**

```bash
git add web/Dockerfile web/nginx.conf docker-compose.yml .env.example
git commit -m "feat(deploy): add web service with nginx reverse proxy to the API"
```

---

## Task 21: Update documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update `README.md`**

Add a new section after "Notes on anti-ban behavior" documenting: the web portal's URL (`http://localhost:8080`), how to create the first super-admin (`npm run create-admin -- --email=... --password=...`), and that tenants log in at `/portal/login` using the `loginEmail`/`passwordHash` set via the admin portal (an admin creates the tenant, then uses "Send password reset" to let the tenant set their own password) — since `POST /admin/tenants` does not currently accept a password directly, note this explicitly as the onboarding path.

- [ ] **Step 2: Replace the "Planned" section in `CLAUDE.md`**

Replace the entire `## Planned: admin + tenant web portals (not yet built)` section with a `## Admin & tenant web portals` section describing (in the same style as the rest of the file — what exists, why, and non-obvious gotchas): the session-vs-api-key dual auth model, that portal controllers reuse the existing api-key controllers, the suspend-vs-delete tenant model, the disconnect-notification/reconnect flow, and the audit log convention (every state-changing admin/portal action writes one row).

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document the admin and tenant web portals"
```

---

## Self-Review Notes

- **Spec coverage:** every section of the spec (data model, auth/sessions, password reset, API surface, disconnect/reconnect/notifications, email service, frontend, deployment, testing, docs) maps to at least one task above (Tasks 1, 2/5/6, 8, 9/11/12/13/14, 10, 7, 16–19, 20, all backend tests, 21).
- **One gap caught and fixed during writing:** the frontend's `SessionsPanel` needed a `GET /portal/sessions` list endpoint that the spec's API surface section didn't spell out as distinct from `GET /portal/sessions/:sessionId` — added as an explicit sub-step (with its own test) in Task 18 rather than leaving it implicit.
- **Type/name consistency checked:** `reconnectSession(tenantId, sessionId)` (Task 10) is called identically in the portal route (Task 10), the admin controller (Task 12), and referenced by the same name in tests. `writeAuditLog` field names (`actorType`, `actorId`, `action`, `targetType`, `targetId`, `tenantId`, `beforeData`, `afterData`) are identical across Tasks 4, 11, 12, 14. `apiFetch<T>` signature is used consistently across all Task 17–19 frontend code.
