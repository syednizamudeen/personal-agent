jest.mock('../../src/db/prisma', () => ({
  whatsAppSession: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
}));
jest.mock('@whiskeysockets/baileys', () => ({
  default: jest.fn(),
  DisconnectReason: {},
  downloadMediaMessage: jest.fn(),
}));
jest.mock('../../src/config/redis', () => ({
  createRedisConnection: jest.fn(() => ({})),
}));
jest.mock('../../src/services/redisAuthState', () => ({
  useRedisAuthState: jest.fn().mockResolvedValue({
    state: {},
    saveCreds: jest.fn(),
  }),
  clearAuthState: jest.fn(),
}));
jest.mock('../../src/services/emailService', () => ({
  sendDisconnectAlertEmail: jest.fn(),
}));

const makeWASocket = require('@whiskeysockets/baileys').default;
const prisma = require('../../src/db/prisma');
const { sendDisconnectAlertEmail } = require('../../src/services/emailService');

describe('reconnectSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('flips the session back to PENDING_QR and starts a new socket', async () => {
    makeWASocket.mockReturnValue({
      ev: { on: jest.fn() },
    });
    const { reconnectSession } = require('../../src/services/baileysManager');
    await reconnectSession('tenant-1', 'session-1');

    expect(prisma.whatsAppSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { status: 'PENDING_QR', qrCode: null },
    });
    expect(makeWASocket).toHaveBeenCalled();
  });
});

describe('notifyDisconnectIfNeeded', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not send email when disconnectNotifiedAt is already set', async () => {
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      id: 'session-1',
      disconnectNotifiedAt: new Date('2025-01-01'),
    });

    const { notifyDisconnectIfNeeded } = require('../../src/services/baileysManager');
    await notifyDisconnectIfNeeded('tenant-1', 'session-1');

    expect(sendDisconnectAlertEmail).not.toHaveBeenCalled();
    expect(prisma.whatsAppSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not send email when tenant has no loginEmail', async () => {
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      id: 'session-1',
      disconnectNotifiedAt: null,
    });
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      name: 'Test Tenant',
      loginEmail: null,
    });

    const { notifyDisconnectIfNeeded } = require('../../src/services/baileysManager');
    await notifyDisconnectIfNeeded('tenant-1', 'session-1');

    expect(sendDisconnectAlertEmail).not.toHaveBeenCalled();
    expect(prisma.whatsAppSession.updateMany).not.toHaveBeenCalled();
  });

  it('sends email and updates disconnectNotifiedAt when conditions are met', async () => {
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      id: 'session-1',
      disconnectNotifiedAt: null,
    });
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      name: 'Acme Corp',
      loginEmail: 'admin@acme.com',
    });
    prisma.whatsAppSession.updateMany.mockResolvedValue({ count: 1 });

    const { notifyDisconnectIfNeeded } = require('../../src/services/baileysManager');
    await notifyDisconnectIfNeeded('tenant-1', 'session-1');

    expect(sendDisconnectAlertEmail).toHaveBeenCalledWith('admin@acme.com', 'Acme Corp');
    expect(prisma.whatsAppSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { disconnectNotifiedAt: expect.any(Date) },
    });
  });

  it('does nothing when session record is not found', async () => {
    prisma.whatsAppSession.findUnique.mockResolvedValue(null);

    const { notifyDisconnectIfNeeded } = require('../../src/services/baileysManager');
    await notifyDisconnectIfNeeded('tenant-1', 'session-1');

    expect(sendDisconnectAlertEmail).not.toHaveBeenCalled();
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.whatsAppSession.updateMany).not.toHaveBeenCalled();
  });
});
