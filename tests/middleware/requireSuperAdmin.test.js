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
  app.use(express.json());
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
