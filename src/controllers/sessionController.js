const prisma = require('../db/prisma');
const { startSession } = require('../services/baileysManager');

async function createTenant(req, res) {
  const { name, rateLimitMinutes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const tenant = await prisma.tenant.create({
    data: { name, rateLimitMinutes: rateLimitMinutes ?? 1440 },
  });

  res.status(201).json(tenant);
}

// A tenant supports exactly one live WhatsApp socket: Baileys auth state is keyed
// per tenant and getSocket() resolves by tenantId. Creating a second session starts
// a second socket on the same credentials, and the two knock each other offline in
// an endless reconnect loop. Reuse the existing row via reconnect instead.
const DUPLICATE_SESSION_ERROR =
  'This tenant already has a WhatsApp session. Reconnect it instead of creating another.';

async function findBlockingSession(tenantId) {
  return prisma.whatsAppSession.findFirst({
    where: { tenantId, status: { in: ['PENDING_QR', 'CONNECTED', 'DISCONNECTED'] } },
  });
}

async function createSession(req, res) {
  const tenant = req.tenant;
  const { label } = req.body;

  const blocking = await findBlockingSession(tenant.id);
  if (blocking) {
    return res.status(409).json({ error: DUPLICATE_SESSION_ERROR, sessionId: blocking.id });
  }

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

async function listSessions(req, res) {
  const sessions = await prisma.whatsAppSession.findMany({ where: { tenantId: req.tenant.id }, orderBy: { createdAt: 'desc' } });
  res.json(
    sessions.map((s) => ({
      sessionId: s.id,
      status: s.status,
      phoneNumber: s.phoneNumber,
      qrCode: s.status === 'PENDING_QR' ? s.qrCode : null,
    }))
  );
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

module.exports = {
  createTenant,
  createSession,
  getSessionStatus,
  listSessions,
  listMessageLogs,
  findBlockingSession,
  DUPLICATE_SESSION_ERROR,
};
