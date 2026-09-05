const prisma = require('../db/prisma');
const { writeAuditLog } = require('../services/auditService');
const { reconnectSession } = require('../services/baileysManager');

async function listTenantMessages(req, res) {
  const { id: tenantId } = req.params;
  const { status, limit } = req.query;
  const logs = await prisma.messageLog.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit || '50', 10), 200),
  });
  res.json(logs);
}

async function listTenantCorrections(req, res) {
  const rules = await prisma.correctionRule.findMany({ where: { tenantId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json(rules);
}

async function createTenantCorrection(req, res) {
  const { id: tenantId } = req.params;
  const { pattern, isRegex, action, forcedReply, category } = req.body;
  if (!pattern || !action) return res.status(400).json({ error: 'pattern and action are required' });

  const rule = await prisma.correctionRule.create({
    data: { tenantId, pattern, isRegex: isRegex ?? true, action, forcedReply: forcedReply ?? null, category: category ?? null },
  });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'CORRECTION_RULE_CREATED',
    targetType: 'CorrectionRule',
    targetId: rule.id,
    tenantId,
    afterData: rule,
  });
  res.status(201).json(rule);
}

async function deleteTenantCorrection(req, res) {
  const { id: tenantId, ruleId } = req.params;
  const rule = await prisma.correctionRule.findFirst({ where: { id: ruleId, tenantId } });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  await prisma.correctionRule.update({ where: { id: ruleId }, data: { active: false } });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'CORRECTION_RULE_DELETED',
    targetType: 'CorrectionRule',
    targetId: ruleId,
    tenantId,
    beforeData: rule,
  });
  res.status(204).send();
}

async function listTenantSessions(req, res) {
  const sessions = await prisma.whatsAppSession.findMany({ where: { tenantId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json(sessions);
}

async function reconnectTenantSession(req, res) {
  const { id: tenantId, sessionId } = req.params;
  await reconnectSession(tenantId, sessionId);
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'SESSION_RECONNECT_TRIGGERED',
    targetType: 'WhatsAppSession',
    targetId: sessionId,
    tenantId,
  });
  res.json({ ok: true });
}

module.exports = {
  listTenantMessages,
  listTenantCorrections,
  createTenantCorrection,
  deleteTenantCorrection,
  listTenantSessions,
  reconnectTenantSession,
};
