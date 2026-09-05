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
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'x@y.com',
      'http://localhost:8080/portal/reset-password?token=raw-token'
    );
  });

  it('builds the reset link from APP_BASE_URL, ignoring an attacker-supplied Origin header', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', loginEmail: 'x@y.com' });
    issueResetToken.mockResolvedValue('raw-token');
    await request(buildApp())
      .post('/portal/forgot-password')
      .set('Origin', 'https://evil.example.com')
      .send({ email: 'x@y.com' });
    const [, resetUrl] = sendPasswordResetEmail.mock.calls[0];
    expect(resetUrl).not.toContain('evil.example.com');
    expect(resetUrl).toBe('http://localhost:8080/portal/reset-password?token=raw-token');
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

  it('POST /reset-password rejects a SUPER_ADMIN token (cross-role security)', async () => {
    consumeResetToken.mockResolvedValue({ actorType: 'SUPER_ADMIN', actorId: 'admin-1' });
    const res = await request(buildApp()).post('/portal/reset-password').send({ token: 'admin-token', password: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('POST /reset-password rejects a missing password before hashing it', async () => {
    const res = await request(buildApp()).post('/portal/reset-password').send({ token: 'good' });
    expect(res.status).toBe(400);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(consumeResetToken).not.toHaveBeenCalled();
  });

  it('POST /reset-password rejects a password shorter than 8 characters', async () => {
    const res = await request(buildApp()).post('/portal/reset-password').send({ token: 'good', password: 'short' });
    expect(res.status).toBe(400);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('PATCH /change-password requires authentication', async () => {
    const app = buildApp();
    const res = await request(app).patch('/portal/change-password').send({ currentPassword: 'old', newPassword: 'new' });
    expect(res.status).toBe(401);
  });

  it('PATCH /change-password rejects wrong current password', async () => {
    const { verifyPassword } = require('../../src/services/authService');
    const app = buildApp();
    const agent = request.agent(app);

    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      loginEmail: 'test@y.com',
      passwordHash: 'old-hash',
      status: 'ACTIVE',
    });
    verifyPassword.mockResolvedValueOnce(true);
    await agent.post('/portal/login').send({ email: 'test@y.com', password: 'pass' });

    verifyPassword.mockResolvedValueOnce(false);
    const res = await agent.patch('/portal/change-password').send({ currentPassword: 'wrong', newPassword: 'newpass123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/current password is incorrect/i);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('PATCH /change-password updates password with correct current password', async () => {
    const { verifyPassword } = require('../../src/services/authService');
    const app = buildApp();
    const agent = request.agent(app);

    prisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      loginEmail: 'test@y.com',
      passwordHash: 'old-hash',
      status: 'ACTIVE',
    });
    verifyPassword.mockResolvedValueOnce(true);
    await agent.post('/portal/login').send({ email: 'test@y.com', password: 'pass' });

    verifyPassword.mockResolvedValueOnce(true);
    hashPassword.mockResolvedValue('new-hash');
    prisma.tenant.update.mockResolvedValue({});

    const res = await agent.patch('/portal/change-password').send({ currentPassword: 'oldpass123', newPassword: 'newpass123' });
    expect(res.status).toBe(200);
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { passwordHash: 'new-hash' } });
  });
});
