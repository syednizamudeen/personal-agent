const prisma = require('../db/prisma');

async function writeAuditLog({ actorType, actorId, action, targetType, targetId, tenantId, beforeData, afterData }) {
  await prisma.auditLog.create({
    data: {
      actorType,
      actorId,
      action,
      targetType,
      targetId,
      tenantId: tenantId ?? null,
      beforeData: beforeData ?? null,
      afterData: afterData ?? null,
    },
  });
}

module.exports = { writeAuditLog };
