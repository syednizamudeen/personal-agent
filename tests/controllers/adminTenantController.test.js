jest.mock('../../src/db/prisma', () => ({
  tenant: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
}));
jest.mock('../../src/services/auditService', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../src/services/passwordResetService', () => ({ issueResetToken: jest.fn() }));
jest.mock('../../src/services/emailService', () => ({ sendPasswordResetEmail: jest.fn() }));

const prisma = require('../../src/db/prisma');
const { writeAuditLog } = require('../../src/services/auditService');
const { issueResetToken } = require('../../src/services/passwordResetService');
const { sendPasswordResetEmail } = require('../../src/services/emailService');
const {
  listTenants,
  createTenant,
  getTenant,
  updateTenant,
  sendTenantPasswordReset,
} = require('../../src/controllers/adminTenantController');

function mockReqRes(overrides = {}) {
  const req = { superAdmin: { id: 'admin-1' }, params: {}, body: {}, query: {}, headers: {}, ...overrides };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { req, res };
}

describe('adminTenantController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists tenants with pagination', async () => {
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }]);
    const { req, res } = mockReqRes({ query: { limit: '10' } });
    await listTenants(req, res);
    expect(prisma.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
    expect(res.json).toHaveBeenCalledWith([{ id: 't1' }]);
  });

  it('creates a tenant and writes an audit log', async () => {
    prisma.tenant.create.mockResolvedValue({ id: 't1', name: 'Acme' });
    const { req, res } = mockReqRes({ body: { name: 'Acme', rateLimitHours: 24 } });
    await createTenant(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'SUPER_ADMIN', actorId: 'admin-1', action: 'TENANT_CREATED', tenantId: 't1' })
    );
  });

  it('updates a tenant status and writes a before/after audit log', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE' });
    prisma.tenant.update.mockResolvedValue({ id: 't1', status: 'SUSPENDED' });
    const { req, res } = mockReqRes({ params: { id: 't1' }, body: { status: 'SUSPENDED' } });
    await updateTenant(req, res);
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'SUSPENDED' } });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TENANT_UPDATED',
        tenantId: 't1',
        beforeData: { status: 'ACTIVE' },
        afterData: { status: 'SUSPENDED' },
      })
    );
  });

  it('updates a tenant loginEmail and writes a before/after audit log', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', loginEmail: 'old@example.com' });
    prisma.tenant.update.mockResolvedValue({ id: 't1', loginEmail: 'new@example.com' });
    const { req, res } = mockReqRes({ params: { id: 't1' }, body: { loginEmail: 'new@example.com' } });
    await updateTenant(req, res);
    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { loginEmail: 'new@example.com' } });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TENANT_UPDATED',
        tenantId: 't1',
        beforeData: { loginEmail: 'old@example.com' },
        afterData: { loginEmail: 'new@example.com' },
      })
    );
  });

  it('returns 404 when updating a nonexistent tenant', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    const { req, res } = mockReqRes({ params: { id: 'nope' }, body: { status: 'SUSPENDED' } });
    await updateTenant(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('sends a password reset for a tenant and audits it', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', loginEmail: 'x@y.com' });
    issueResetToken.mockResolvedValue('raw-token');
    // Origin is attacker-controlled and must be ignored in favour of APP_BASE_URL.
    const { req, res } = mockReqRes({ params: { id: 't1' }, headers: { origin: 'https://evil.example.com' } });
    await sendTenantPasswordReset(req, res);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'x@y.com',
      'http://localhost:8080/portal/reset-password?token=raw-token'
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TENANT_PASSWORD_RESET_TRIGGERED', tenantId: 't1' })
    );
  });
});
