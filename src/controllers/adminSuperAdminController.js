const prisma = require('../db/prisma');
const { hashPassword } = require('../services/authService');
const { writeAuditLog } = require('../services/auditService');

async function listSuperAdmins(req, res) {
  const admins = await prisma.superAdmin.findMany({
    select: { id: true, email: true, name: true, createdAt: true, passwordHash: false },
  });
  res.json(admins);
}

async function createSuperAdmin(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const passwordHash = await hashPassword(password);
  const admin = await prisma.superAdmin.create({ data: { email, passwordHash, name } });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'SUPER_ADMIN_CREATED',
    targetType: 'SuperAdmin',
    targetId: admin.id,
  });
  res.status(201).json({ id: admin.id, email: admin.email, name: admin.name });
}

module.exports = { listSuperAdmins, createSuperAdmin };
