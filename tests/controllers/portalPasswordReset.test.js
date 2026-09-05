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
