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

        activeSockets.delete(tenantId);

        if (loggedOut) {
          await clearAuthState(redis, tenantId);
          await notifyDisconnectIfNeeded(tenantId, sessionId);
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
    where: { status: { in: ['CONNECTED', 'PENDING_QR'] } },
  });

  for (const session of sessions) {
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
