jest.mock('../../src/db/prisma', () => ({
  superAdmin: { findUnique: jest.fn(), update: jest.fn() },
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
const adminAuthRouter = require('../../src/controllers/adminAuthController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.use('/admin', adminAuthRouter);
  return app;
}

describe('admin password reset', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST /forgot-password always returns 200, even for an unknown email', async () => {
    prisma.superAdmin.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).post('/admin/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(issueResetToken).not.toHaveBeenCalled();
  });

  it('POST /forgot-password issues a token and emails it for a known super-admin', async () => {
    prisma.superAdmin.findUnique.mockResolvedValue({ id: 'admin-1', email: 'admin@y.com' });
    issueResetToken.mockResolvedValue('raw-token');
    const res = await request(buildApp()).post('/admin/forgot-password').send({ email: 'admin@y.com' });
    expect(res.status).toBe(200);
    expect(issueResetToken).toHaveBeenCalledWith('SUPER_ADMIN', 'admin-1');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith('admin@y.com', expect.stringContaining('raw-token'));
  });

  it('POST /reset-password rejects an invalid/expired token', async () => {
    consumeResetToken.mockResolvedValue(null);
    const res = await request(buildApp()).post('/admin/reset-password').send({ token: 'bad', password: 'newpass123' });
    expect(res.status).toBe(400);
  });

  it('POST /reset-password updates the password on a valid token', async () => {
    consumeResetToken.mockResolvedValue({ actorType: 'SUPER_ADMIN', actorId: 'admin-1' });
    hashPassword.mockResolvedValue('new-hash');
    prisma.superAdmin.update.mockResolvedValue({});
    const res = await request(buildApp()).post('/admin/reset-password').send({ token: 'good', password: 'newpass123' });
    expect(res.status).toBe(200);
    expect(prisma.superAdmin.update).toHaveBeenCalledWith({ where: { id: 'admin-1' }, data: { passwordHash: 'new-hash' } });
  });

  it('POST /reset-password rejects a TENANT token (cross-role security)', async () => {
    consumeResetToken.mockResolvedValue({ actorType: 'TENANT', actorId: 't1' });
    const res = await request(buildApp()).post('/admin/reset-password').send({ token: 'tenant-token', password: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
    expect(prisma.superAdmin.update).not.toHaveBeenCalled();
  });
});
