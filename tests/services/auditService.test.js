jest.mock('../../src/db/prisma', () => ({
  auditLog: { create: jest.fn() },
}));

const prisma = require('../../src/db/prisma');
const { writeAuditLog } = require('../../src/services/auditService');

describe('writeAuditLog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes an audit log row with the given fields', async () => {
    await writeAuditLog({
      actorType: 'SUPER_ADMIN',
      actorId: 'admin-1',
      action: 'TENANT_SUSPENDED',
      targetType: 'Tenant',
      targetId: 'tenant-1',
      tenantId: 'tenant-1',
      beforeData: { status: 'ACTIVE' },
      afterData: { status: 'SUSPENDED' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'SUPER_ADMIN',
        actorId: 'admin-1',
        action: 'TENANT_SUSPENDED',
        targetType: 'Tenant',
        targetId: 'tenant-1',
        tenantId: 'tenant-1',
        beforeData: { status: 'ACTIVE' },
        afterData: { status: 'SUSPENDED' },
      },
    });
  });

  it('defaults beforeData/afterData/tenantId to null when omitted', async () => {
    await writeAuditLog({
      actorType: 'TENANT',
      actorId: 'tenant-1',
      action: 'CORRECTION_RULE_CREATED',
      targetType: 'CorrectionRule',
      targetId: 'rule-1',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'TENANT',
        actorId: 'tenant-1',
        action: 'CORRECTION_RULE_CREATED',
        targetType: 'CorrectionRule',
        targetId: 'rule-1',
        tenantId: null,
        beforeData: null,
        afterData: null,
      },
    });
  });
});
