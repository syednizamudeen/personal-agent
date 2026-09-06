jest.mock('../../src/db/prisma', () => ({
  whatsAppSession: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn(),
    findMany: jest.fn(),
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

// Regression: a second session started for a tenant that already had one produced two
// Baileys sockets sharing tenant-scoped credentials. Each close handler reconnected its
// own socket, which knocked the other offline — 344 reconnect loops in 25 minutes live,
// and the tenant's real WhatsApp connection never came back up.
describe('one socket per tenant', () => {
  // No jest.resetModules() here: the module-level activeSockets Map is the thing under
  // test, so we clear it directly and keep the same mock instances the file captured.
  beforeEach(() => {
    jest.clearAllMocks();
    const { activeSockets } = require('../../src/services/baileysManager');
    activeSockets.clear();
    prisma.whatsAppSession.updateMany.mockResolvedValue({ count: 1 });
  });

  function makeFakeSocket() {
    const handlers = {};
    return {
      sock: { ev: { on: (event, fn) => (handlers[event] = fn) }, end: jest.fn() },
      fire: (event, payload) => handlers[event](payload),
    };
  }

  it('ends the previous socket when a tenant starts another session', async () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    makeWASocket.mockReturnValueOnce(first.sock).mockReturnValueOnce(second.sock);

    const { startSession, activeSockets } = require('../../src/services/baileysManager');
    await startSession('tenant-1', 'session-1');
    await startSession('tenant-1', 'session-2');

    expect(first.sock.end).toHaveBeenCalled();
    expect(activeSockets.get('tenant-1')).toBe(second.sock);
  });

  it('does not reconnect a superseded socket when it closes', async () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    makeWASocket.mockReturnValueOnce(first.sock).mockReturnValueOnce(second.sock);

    const { startSession, activeSockets } = require('../../src/services/baileysManager');
    await startSession('tenant-1', 'session-1');
    await startSession('tenant-1', 'session-2');
    makeWASocket.mockClear();

    // The displaced socket closes, as it will right after being ended.
    await first.fire('connection.update', { connection: 'close', lastDisconnect: { error: new Error('gone') } });

    expect(makeWASocket).not.toHaveBeenCalled(); // no resurrection
    expect(activeSockets.get('tenant-1')).toBe(second.sock); // live socket untouched
  });

  it('resumes DISCONNECTED sessions on boot but never LOGGED_OUT ones', async () => {
    prisma.whatsAppSession.findMany.mockResolvedValue([]);
    makeWASocket.mockReturnValue(makeFakeSocket().sock);

    const { resumeActiveSessions } = require('../../src/services/baileysManager');
    await resumeActiveSessions();

    const { where } = prisma.whatsAppSession.findMany.mock.calls[0][0];
    expect(where.status.in).toContain('DISCONNECTED');
    expect(where.status.in).not.toContain('LOGGED_OUT'); // creds are cleared; needs a human
  });

  it('resumes only the newest session per tenant on boot', async () => {
    prisma.whatsAppSession.findMany.mockResolvedValue([
      { id: 'newer', tenantId: 'tenant-1', status: 'CONNECTED' },
      { id: 'older', tenantId: 'tenant-1', status: 'CONNECTED' },
      { id: 'other', tenantId: 'tenant-2', status: 'PENDING_QR' },
    ]);
    makeWASocket.mockReturnValue(makeFakeSocket().sock);

    const { resumeActiveSessions } = require('../../src/services/baileysManager');
    await resumeActiveSessions();
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.whatsAppSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    );
    expect(makeWASocket).toHaveBeenCalledTimes(2); // one per tenant, not three
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
