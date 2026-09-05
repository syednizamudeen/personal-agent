jest.mock('../../src/db/prisma', () => ({
  auditLog: { findMany: jest.fn() },
}));

const prisma = require('../../src/db/prisma');
const { listAuditLogs } = require('../../src/controllers/adminAuditController');

describe('listAuditLogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filters by tenantId, actorType, and action when provided', async () => {
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'a1' }]);
    const req = { query: { tenantId: 't1', actorType: 'SUPER_ADMIN', action: 'TENANT_CREATED', limit: '10' } };
    const res = { json: jest.fn() };
    await listAuditLogs(req, res);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', actorType: 'SUPER_ADMIN', action: 'TENANT_CREATED' },
        take: 10,
      })
    );
    expect(res.json).toHaveBeenCalledWith([{ id: 'a1' }]);
  });

  it('applies no filters when none are given', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    const req = { query: {} };
    const res = { json: jest.fn() };
    await listAuditLogs(req, res);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
