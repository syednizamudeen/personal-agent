const prisma = require('../db/prisma');

async function requireTenantSession(req, res, next) {
  const tenantId = req.session?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'Not logged in' });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return res.status(401).json({ error: 'Not logged in' });
  if (tenant.status !== 'ACTIVE') return res.status(403).json({ error: 'Account suspended' });

  req.tenant = tenant;
  next();
}

module.exports = requireTenantSession;
