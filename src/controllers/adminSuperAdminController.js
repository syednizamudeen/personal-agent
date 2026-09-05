const prisma = require('../db/prisma');
const { hashPassword } = require('../services/authService');
const { writeAuditLog } = require('../services/auditService');

async function listSuperAdmins(req, res) {
  const admins = await prisma.superAdmin.findMany({
    select: { id: true, email: true, name: true, createdAt: true, passwordHash: false },
  });
  res.json(admins);
}

const MIN_PASSWORD_LENGTH = 8;

async function createSuperAdmin(req, res) {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const passwordHash = await hashPassword(password);

  let admin;
  try {
    admin = await prisma.superAdmin.create({ data: { email, passwordHash, name } });
  } catch (err) {
    // P2002 = unique constraint violation (duplicate email). Anything else is a
    // real failure and is rethrown for asyncHandler -> the global error handler.
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'A super-admin with that email already exists' });
    }
    throw err;
  }
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
