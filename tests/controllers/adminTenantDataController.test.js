jest.mock('../../src/db/prisma', () => ({
  messageLog: { findMany: jest.fn() },
  correctionRule: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  whatsAppSession: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
  tenant: { findUnique: jest.fn() },
}));
jest.mock('../../src/services/auditService', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../src/services/baileysManager', () => ({ reconnectSession: jest.fn(), startSession: jest.fn() }));

const prisma = require('../../src/db/prisma');
const { writeAuditLog } = require('../../src/services/auditService');
const { reconnectSession, startSession } = require('../../src/services/baileysManager');
const {
  listTenantMessages,
  listTenantCorrections,
  createTenantCorrection,
  deleteTenantCorrection,
  listTenantSessions,
  createTenantSession,
  reconnectTenantSession,
} = require('../../src/controllers/adminTenantDataController');

function mockReqRes(overrides = {}) {
  const req = { superAdmin: { id: 'admin-1' }, params: {}, body: {}, query: {}, ...overrides };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
  return { req, res };
}

describe('adminTenantDataController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists a tenant\'s messages, scoped by tenantId param', async () => {
    prisma.messageLog.findMany.mockResolvedValue([{ id: 'm1' }]);
    const { req, res } = mockReqRes({ params: { id: 't1' } });
    await listTenantMessages(req, res);
    expect(prisma.messageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) })
    );
    expect(res.json).toHaveBeenCalledWith([{ id: 'm1' }]);
  });

  it('creates a correction rule for a tenant and audits it', async () => {
    prisma.correctionRule.create.mockResolvedValue({ id: 'r1', tenantId: 't1' });
    const { req, res } = mockReqRes({ params: { id: 't1' }, body: { pattern: 'rip', action: 'SKIP_REPLY' } });
    await createTenantCorrection(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CORRECTION_RULE_CREATED', tenantId: 't1', actorType: 'SUPER_ADMIN' })
    );
  });

  it('rejects an unknown correction action with a 400', async () => {
    const { req, res } = mockReqRes({ params: { id: 't1' }, body: { pattern: 'rip', action: 'DELETE_EVERYTHING' } });
    await createTenantCorrection(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.correctionRule.create).not.toHaveBeenCalled();
  });

  it('reconnects a tenant session and audits it', async () => {
    const { req, res } = mockReqRes({ params: { id: 't1', sessionId: 's1' } });
    await reconnectTenantSession(req, res);
    expect(reconnectSession).toHaveBeenCalledWith('t1', 's1');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_RECONNECT_TRIGGERED', tenantId: 't1', targetId: 's1' })
    );
  });

  describe('createTenantSession', () => {
    it('creates a PENDING_QR session, starts the socket, and audits it', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.whatsAppSession.create.mockResolvedValue({ id: 's1', status: 'PENDING_QR', label: 'Main Line' });
      startSession.mockResolvedValue(undefined);

      const { req, res } = mockReqRes({ params: { id: 't1' } });
      await createTenantSession(req, res);

      expect(prisma.whatsAppSession.create).toHaveBeenCalledWith({
        data: { tenantId: 't1', label: 'Main Line', status: 'PENDING_QR' },
      });
      expect(startSession).toHaveBeenCalledWith('t1', 's1');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ sessionId: 's1', status: 'PENDING_QR' });
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SESSION_CREATED', tenantId: 't1', targetId: 's1' })
      );
    });

    // Two sockets for one tenant share tenant-scoped Baileys creds and knock each
    // other offline forever. Observed live: 344 reconnect loops in 25 minutes.
    it('409s instead of creating a second session for a tenant that already has one', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.whatsAppSession.findFirst.mockResolvedValue({ id: 'existing', status: 'CONNECTED' });

      const { req, res } = mockReqRes({ params: { id: 't1' } });
      await createTenantSession(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(prisma.whatsAppSession.create).not.toHaveBeenCalled();
      expect(startSession).not.toHaveBeenCalled();
    });

    it('allows a new session once the previous one is LOGGED_OUT', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.whatsAppSession.findFirst.mockResolvedValue(null); // LOGGED_OUT is not blocking
      prisma.whatsAppSession.create.mockResolvedValue({ id: 's2', status: 'PENDING_QR', label: 'Main Line' });
      startSession.mockResolvedValue(undefined);

      const { req, res } = mockReqRes({ params: { id: 't1' } });
      await createTenantSession(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(startSession).toHaveBeenCalledWith('t1', 's2');
    });

    it('404s for an unknown tenant rather than creating an orphan session', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      const { req, res } = mockReqRes({ params: { id: 'nope' } });
      await createTenantSession(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.whatsAppSession.create).not.toHaveBeenCalled();
      expect(startSession).not.toHaveBeenCalled();
    });

    it('still responds 201 when startSession rejects, without an unhandled rejection', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.whatsAppSession.create.mockResolvedValue({ id: 's1', status: 'PENDING_QR', label: 'Main Line' });
      startSession.mockRejectedValue(new Error('whatsapp unreachable'));

      const rejections = [];
      const onRejection = (err) => rejections.push(err);
      process.on('unhandledRejection', onRejection);
      try {
        const { req, res } = mockReqRes({ params: { id: 't1' } });
        await createTenantSession(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
        await new Promise((resolve) => setImmediate(resolve));
        expect(rejections).toEqual([]);
      } finally {
        process.off('unhandledRejection', onRejection);
      }
    });
  });
});
