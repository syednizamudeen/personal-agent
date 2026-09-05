jest.mock('../../src/db/prisma', () => ({
  superAdmin: { findMany: jest.fn(), create: jest.fn() },
}));
jest.mock('../../src/services/authService', () => ({ hashPassword: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ writeAuditLog: jest.fn() }));

const prisma = require('../../src/db/prisma');
const { hashPassword } = require('../../src/services/authService');
const { writeAuditLog } = require('../../src/services/auditService');
const { listSuperAdmins, createSuperAdmin } = require('../../src/controllers/adminSuperAdminController');

describe('adminSuperAdminController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists super admins without exposing passwordHash', async () => {
    prisma.superAdmin.findMany.mockResolvedValue([{ id: 'a1', email: 'a@b.com', name: 'Ada' }]);
    const req = {};
    const res = { json: jest.fn() };
    await listSuperAdmins(req, res);
    expect(prisma.superAdmin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ passwordHash: false }) })
    );
    expect(res.json).toHaveBeenCalledWith([{ id: 'a1', email: 'a@b.com', name: 'Ada' }]);
  });

  it('creates a super admin with a hashed password and audits it', async () => {
    hashPassword.mockResolvedValue('hash123');
    prisma.superAdmin.create.mockResolvedValue({ id: 'a2', email: 'new@b.com', name: 'New' });
    const req = { superAdmin: { id: 'admin-1' }, body: { email: 'new@b.com', password: 'pw-long-enough', name: 'New' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createSuperAdmin(req, res);
    expect(prisma.superAdmin.create).toHaveBeenCalledWith({
      data: { email: 'new@b.com', passwordHash: 'hash123', name: 'New' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUPER_ADMIN_CREATED', actorId: 'admin-1' })
    );
  });

  it('rejects a password shorter than 8 characters with a 400', async () => {
    const req = { superAdmin: { id: 'admin-1' }, body: { email: 'new@b.com', password: 'short' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createSuperAdmin(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.superAdmin.create).not.toHaveBeenCalled();
  });

  it('returns 409 instead of throwing when the email is already taken', async () => {
    hashPassword.mockResolvedValue('hash123');
    const duplicate = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    prisma.superAdmin.create.mockRejectedValue(duplicate);
    const req = { superAdmin: { id: 'admin-1' }, body: { email: 'taken@b.com', password: 'pw-long-enough' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await expect(createSuperAdmin(req, res)).resolves.toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('rethrows non-unique-constraint database errors so asyncHandler can surface them', async () => {
    hashPassword.mockResolvedValue('hash123');
    prisma.superAdmin.create.mockRejectedValue(new Error('connection lost'));
    const req = { superAdmin: { id: 'admin-1' }, body: { email: 'x@b.com', password: 'pw-long-enough' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await expect(createSuperAdmin(req, res)).rejects.toThrow('connection lost');
  });
});
