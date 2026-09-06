const prisma = require('../db/prisma');
const { writeAuditLog } = require('../services/auditService');
const { reconnectSession, startSession } = require('../services/baileysManager');
const logger = require('../config/logger');
const { findBlockingSession, DUPLICATE_SESSION_ERROR } = require('./sessionController');

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

  // Mirrors the validation in reviewController.createCorrection.
  const validActions = ['SKIP_REPLY', 'FORCE_GREETING', 'FORCE_CATEGORY'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of ${validActions.join(', ')}` });
  }

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

// Mirrors sessionController.createSession, but scoped by :id rather than req.tenant, so a
// super-admin can start the QR flow during onboarding instead of it being portal-only.
async function createTenantSession(req, res) {
  const { id: tenantId } = req.params;
  const { label } = req.body;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  // Same one-socket-per-tenant rule the portal enforces; see sessionController.
  const blocking = await findBlockingSession(tenantId);
  if (blocking) {
    return res.status(409).json({ error: DUPLICATE_SESSION_ERROR, sessionId: blocking.id });
  }

  const session = await prisma.whatsAppSession.create({
    data: { tenantId, label: label || 'Main Line', status: 'PENDING_QR' },
  });

  // Fire-and-forget: the QR arrives asynchronously on the session row, which the
  // admin UI polls for. Awaiting it would hold the request open until WhatsApp replies.
  startSession(tenantId, session.id).catch((err) => {
    logger.error({ err, tenantId, sessionId: session.id }, 'Failed to start admin-created session');
  });

  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'SESSION_CREATED',
    targetType: 'WhatsAppSession',
    targetId: session.id,
    tenantId,
    afterData: { status: session.status, label: session.label },
  });

  res.status(201).json({ sessionId: session.id, status: session.status });
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
  createTenantSession,
  reconnectTenantSession,
};
