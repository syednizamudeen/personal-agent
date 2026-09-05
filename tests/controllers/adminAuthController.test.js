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
