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
const portalAuthController = require('../../src/controllers/portalAuthController');
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
    portalAuthController.post('/login-test-helper', (req, res) => {
      req.session.tenantId = 't1';
      res.json({ ok: true });
    });
    const app = buildApp();
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
