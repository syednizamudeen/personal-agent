jest.mock('../../src/db/prisma', () => ({
  whatsAppSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
