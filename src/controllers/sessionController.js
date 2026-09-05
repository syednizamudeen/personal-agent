const prisma = require('../db/prisma');
const { startSession } = require('../services/baileysManager');

async function createTenant(req, res) {
  const { name, rateLimitHours } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const tenant = await prisma.tenant.create({
    data: { name, rateLimitHours: rateLimitHours ?? 24 },
  });

  res.status(201).json(tenant);
}

async function createSession(req, res) {
  const tenant = req.tenant;
  const { label } = req.body;

  const session = await prisma.whatsAppSession.create({
    data: { tenantId: tenant.id, label, status: 'PENDING_QR' },
  });

  startSession(tenant.id, session.id).catch((err) => {
    req.log?.error?.(err) || console.error(err);
  });

  res.status(201).json({ sessionId: session.id, status: session.status });
}

async function getSessionStatus(req, res) {
  const tenant = req.tenant;
  const { sessionId } = req.params;

  const session = await prisma.whatsAppSession.findFirst({
    where: { id: sessionId, tenantId: tenant.id },
  });

  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    sessionId: session.id,
    status: session.status,
    phoneNumber: session.phoneNumber,
    qrCode: session.status === 'PENDING_QR' ? session.qrCode : null,
  });
}

async function listMessageLogs(req, res) {
  const tenant = req.tenant;
  const { status, limit } = req.query;

  const logs = await prisma.messageLog.findMany({
    where: { tenantId: tenant.id, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit || '50', 10), 200),
  });

  res.json(logs);
}

module.exports = { createTenant, createSession, getSessionStatus, listMessageLogs };
