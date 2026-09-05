// Boots the REAL composed app (src/app.js — the same factory server.js uses), so
// route mount order is exercised for real. Router-only test apps cannot catch the
// class of bug this file guards: '/api/v1' is a prefix of '/api/v1/portal' and
// '/api/v1/admin', and routes/api.js has a path-less requireTenant gate that 401s
// every request reaching it. If apiRoutes is mounted first, portal/admin requests
// die on the x-api-key gate before their own routers ever run.
jest.mock('../src/db/prisma', () => ({
  tenant: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  superAdmin: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  whatsAppSession: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  messageLog: { findMany: jest.fn() },
  correctionRule: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  auditLog: { create: jest.fn(), findMany: jest.fn() },
  passwordResetToken: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
}));
jest.mock('../src/services/baileysManager', () => ({
  startSession: jest.fn(),
  reconnectSession: jest.fn(),
  resumeActiveSessions: jest.fn(),
}));
// These open real Redis connections at module load, which the route modules pull in.
jest.mock('../src/queues/messageQueue', () => ({
  messageQueue: { getJobCounts: jest.fn() },
  enqueueIncomingMessage: jest.fn(),
  startMessageWorker: jest.fn(),
}));
jest.mock('../src/queues/replyQueue', () => ({
  replyQueue: { getJobCounts: jest.fn() },
  enqueueOutgoingReply: jest.fn(),
  startReplyWorker: jest.fn(),
}));
jest.mock('../src/config/redis', () => ({ createRedisConnection: jest.fn(() => ({})) }));
jest.mock('../src/services/authService', () => ({
  verifyPassword: jest.fn(),
  hashPassword: jest.fn(async () => 'hashed'),
}));

const session = require('express-session');
const request = require('supertest');
const prisma = require('../src/db/prisma');
const { verifyPassword } = require('../src/services/authService');
const { createApp } = require('../src/app');

const API_KEY_ERROR = 'x-api-key header is required';

function buildApp() {
  return createApp({ sessionStore: new session.MemoryStore() });
}

describe('composed app route mount order', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes POST /api/v1/portal/login to the portal router, not the x-api-key gate', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null); // no such tenant -> bad credentials

    const res = await request(buildApp())
      .post('/api/v1/portal/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(res.body.error).not.toBe(API_KEY_ERROR);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
  });

  it('routes POST /api/v1/admin/login to the admin router, not the x-api-key gate', async () => {
    prisma.superAdmin.findUnique.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/v1/admin/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(res.body.error).not.toBe(API_KEY_ERROR);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
  });

  it('routes POST /api/v1/portal/forgot-password to the portal router', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/v1/portal/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.body.error).not.toBe(API_KEY_ERROR);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('reaches the session-auth gate (not the api-key gate) for guarded portal routes', async () => {
    const res = await request(buildApp()).get('/api/v1/portal/messages');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not logged in' });
  });

  it('reaches the session-auth gate (not the api-key gate) for guarded admin routes', async () => {
    const res = await request(buildApp()).get('/api/v1/admin/tenants');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not logged in' });
  });

  it('still requires x-api-key on the pre-existing /api/v1 routes', async () => {
    const res = await request(buildApp()).post('/api/v1/sessions').send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: API_KEY_ERROR });
  });

  it('still rejects an unknown x-api-key on the pre-existing /api/v1 routes', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/v1/messages').set('x-api-key', 'bogus');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid API key' });
  });

  it('turns a Prisma failure inside an async route into a 500, not an unhandled rejection', async () => {
    // requireSuperAdmin resolves, then the tenant list query blows up.
    prisma.superAdmin.findUnique.mockResolvedValue({ id: 'admin-1', email: 'a@b.com' });
    prisma.tenant.findMany.mockRejectedValue(new Error('connection lost'));

    const rejections = [];
    const onRejection = (err) => rejections.push(err);
    process.on('unhandledRejection', onRejection);
    try {
      // Log in so requireSuperAdmin passes.
      verifyPassword.mockResolvedValue(true);
      const agent = request.agent(buildApp());
      await agent.post('/api/v1/admin/login').send({ email: 'a@b.com', password: 'pw-long-enough' });

      const res = await agent.get('/api/v1/admin/tenants');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('returns 409 rather than crashing when a super-admin email is already taken', async () => {
    prisma.superAdmin.findUnique.mockResolvedValue({ id: 'admin-1', email: 'a@b.com' });
    prisma.superAdmin.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    );

    verifyPassword.mockResolvedValue(true);
    const agent = request.agent(buildApp());
    await agent.post('/api/v1/admin/login').send({ email: 'a@b.com', password: 'pw-long-enough' });

    const res = await agent
      .post('/api/v1/admin/super-admins')
      .send({ email: 'taken@b.com', password: 'pw-long-enough' });
    expect(res.status).toBe(409);
  });

  it('serves /health', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
