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
