const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const { Boom } = require('@hapi/boom');
const prisma = require('../db/prisma');
const logger = require('../config/logger');
const { createRedisConnection } = require('../config/redis');
const { useRedisAuthState, clearAuthState } = require('./redisAuthState');
const { sendDisconnectAlertEmail } = require('./emailService');

// Required lazily inside handleIncomingMessage to avoid a circular require
// (messageQueue -> replyQueue -> baileysManager -> messageQueue).
function getMessageQueue() {
  return require('../queues/messageQueue');
}

const redis = createRedisConnection();

// tenantId -> active baileys socket, kept in-process on this worker.
const activeSockets = new Map();

async function startSession(tenantId, sessionId) {
  // One live socket per tenant: Baileys auth state lives at tenant:<id>:auth:* and
  // getSocket() resolves by tenantId, so a second concurrent socket would share one
  // set of credentials with the first. Replace rather than run both in parallel.
  const existing = activeSockets.get(tenantId);
  if (existing) {
    logger.warn({ tenantId, sessionId }, 'Replacing existing socket for tenant');
    activeSockets.delete(tenantId);
    try {
      existing.end(undefined);
    } catch (err) {
      logger.warn({ err, tenantId }, 'Failed to close previous socket cleanly');
    }
  }

  const { state, saveCreds } = await useRedisAuthState(redis, tenantId);

  const sock = makeWASocket({
    auth: state,
    logger: logger.child({ tenantId }),
    printQRInTerminal: false,
  });

  activeSockets.set(tenantId, sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr);
        const { count } = await prisma.whatsAppSession.updateMany({
          where: { id: sessionId },
          data: { status: 'PENDING_QR', qrCode: qrDataUrl },
        });
        if (count === 0) {
          // Session row was deleted (e.g. tenant removed) while this socket was still
          // live — stop here instead of looping forever against a nonexistent session.
          logger.warn({ tenantId, sessionId }, 'Session record gone, tearing down socket');
          activeSockets.delete(tenantId);
          sock.end(undefined);
          return;
        }
      }

      if (connection === 'open') {
        await prisma.whatsAppSession.updateMany({
          where: { id: sessionId },
          data: {
            status: 'CONNECTED',
            qrCode: null,
            phoneNumber: sock.user?.id?.split(':')[0] || null,
          },
        });
        await prisma.whatsAppSession.updateMany({ where: { id: sessionId }, data: { disconnectNotifiedAt: null } });
        logger.info({ tenantId, sessionId }, 'WhatsApp session connected');
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        const { count } = await prisma.whatsAppSession.updateMany({
          where: { id: sessionId },
          data: { status: loggedOut ? 'LOGGED_OUT' : 'DISCONNECTED' },
        });

        // Only clear the tenant's slot if WE are still the socket occupying it.
        // A superseded socket (a second session started for the same tenant) must
        // not evict the live one, and must not reconnect itself: auth state is
        // keyed per tenant, so two sockets share one set of creds and each
        // reconnect kicks the other off in an endless war.
        const isCurrent = activeSockets.get(tenantId) === sock;
        if (isCurrent) activeSockets.delete(tenantId);

        if (loggedOut) {
          await clearAuthState(redis, tenantId);
          await notifyDisconnectIfNeeded(tenantId, sessionId);
        } else if (!isCurrent) {
          logger.warn({ tenantId, sessionId }, 'Superseded socket closed, not reconnecting');
        } else if (count === 0) {
          logger.warn({ tenantId, sessionId }, 'Session record gone, not reconnecting');
        } else {
          logger.warn({ tenantId, sessionId }, 'WhatsApp session dropped, reconnecting');
          await startSession(tenantId, sessionId);
        }
      }
    } catch (err) {
      logger.error({ err, tenantId, sessionId }, 'Error handling connection.update');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue;

      try {
        await handleIncomingMessage(sock, tenantId, sessionId, msg);
      } catch (err) {
        logger.error({ err, tenantId }, 'Failed to enqueue incoming message');
      }
    }
  });

  return sock;
}

async function handleIncomingMessage(sock, tenantId, sessionId, msg) {
  const remoteJid = msg.key.remoteJid;
  const messageContent = msg.message;

  const text =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    messageContent.imageMessage?.caption ||
    null;

  const isImage = Boolean(messageContent.imageMessage);
  let mediaBase64 = null;

  if (isImage) {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    mediaBase64 = buffer.toString('base64');
  }

  await getMessageQueue().enqueueIncomingMessage({
    tenantId,
    sessionId,
    remoteJid,
    messageType: isImage ? 'image' : 'text',
    text,
    mediaBase64,
    messageKey: msg.key,
  });
}

function getSocket(tenantId) {
  return activeSockets.get(tenantId);
}

/**
 * Reconnects every session that was CONNECTED or PENDING_QR before this
 * process last stopped. Baileys creds are persisted in Redis independently of
 * this in-process socket map, so a CONNECTED session resumes without a QR
 * scan; a PENDING_QR one simply gets a fresh QR to display.
 */
async function resumeActiveSessions() {
  const sessions = await prisma.whatsAppSession.findMany({
    // DISCONNECTED is included deliberately: it is a transient state (a network blip,
    // or a process killed mid-connection), and the Redis creds are still intact, so the
    // socket resumes with no QR scan. Only LOGGED_OUT is terminal — its creds are
    // cleared, so it genuinely needs a human to re-link. Leaving DISCONNECTED out meant
    // a session that dropped while the process was down stayed dead until someone
    // noticed and clicked Reconnect.
    where: { status: { in: ['CONNECTED', 'PENDING_QR', 'DISCONNECTED'] } },
    orderBy: { createdAt: 'desc' },
  });

  // At most one socket per tenant (shared per-tenant auth state). If a tenant somehow
  // has several resumable rows, resume only the newest and leave the rest alone —
  // starting both would have them fight over the same credentials.
  const seen = new Set();
  for (const session of sessions) {
    if (seen.has(session.tenantId)) {
      logger.warn(
        { tenantId: session.tenantId, sessionId: session.id },
        'Skipping duplicate resumable session for tenant'
      );
      continue;
    }
    seen.add(session.tenantId);
    logger.info({ tenantId: session.tenantId, sessionId: session.id }, 'Resuming WhatsApp session on boot');
    startSession(session.tenantId, session.id).catch((err) => {
      logger.error({ err, tenantId: session.tenantId }, 'Failed to resume session on boot');
    });
  }
}

async function notifyDisconnectIfNeeded(tenantId, sessionId) {
  const session = await prisma.whatsAppSession.findUnique({ where: { id: sessionId } });
  if (!session || session.disconnectNotifiedAt) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.loginEmail) return;

  await sendDisconnectAlertEmail(tenant.loginEmail, tenant.name);
  await prisma.whatsAppSession.updateMany({ where: { id: sessionId }, data: { disconnectNotifiedAt: new Date() } });
}

async function reconnectSession(tenantId, sessionId) {
  await prisma.whatsAppSession.updateMany({
    where: { id: sessionId },
    data: { status: 'PENDING_QR', qrCode: null },
  });
  await startSession(tenantId, sessionId);
}

module.exports = { startSession, reconnectSession, notifyDisconnectIfNeeded, getSocket, activeSockets, resumeActiveSessions };
