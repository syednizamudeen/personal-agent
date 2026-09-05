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
  app.use(express.json());
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
