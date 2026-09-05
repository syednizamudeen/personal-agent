const prisma = require('../db/prisma');

async function requireSuperAdmin(req, res, next) {
  const superAdminId = req.session?.superAdminId;
  if (!superAdminId) return res.status(401).json({ error: 'Not logged in' });

  const superAdmin = await prisma.superAdmin.findUnique({ where: { id: superAdminId } });
  if (!superAdmin) return res.status(401).json({ error: 'Not logged in' });

  req.superAdmin = superAdmin;
  next();
}

module.exports = requireSuperAdmin;
