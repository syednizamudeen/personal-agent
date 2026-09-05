jest.mock('../../src/db/prisma', () => ({
  messageLog: { findMany: jest.fn() },
  correctionRule: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  whatsAppSession: { findMany: jest.fn() },
}));
jest.mock('../../src/services/auditService', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../src/services/baileysManager', () => ({ reconnectSession: jest.fn() }));

const prisma = require('../../src/db/prisma');
const { writeAuditLog } = require('../../src/services/auditService');
const { reconnectSession } = require('../../src/services/baileysManager');
const {
  listTenantMessages,
  listTenantCorrections,
  createTenantCorrection,
  deleteTenantCorrection,
  listTenantSessions,
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

  it('reconnects a tenant session and audits it', async () => {
    const { req, res } = mockReqRes({ params: { id: 't1', sessionId: 's1' } });
    await reconnectTenantSession(req, res);
    expect(reconnectSession).toHaveBeenCalledWith('t1', 's1');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_RECONNECT_TRIGGERED', tenantId: 't1', targetId: 's1' })
    );
  });
});
