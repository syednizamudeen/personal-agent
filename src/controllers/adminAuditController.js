const prisma = require('../db/prisma');

async function listAuditLogs(req, res) {
  const { tenantId, actorType, action, limit } = req.query;
  const where = {};
  if (tenantId) where.tenantId = tenantId;
  if (actorType) where.actorType = actorType;
  if (action) where.action = action;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit || '50', 10), 200),
  });
  res.json(logs);
}

module.exports = { listAuditLogs };
