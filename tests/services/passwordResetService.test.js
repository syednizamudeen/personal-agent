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
