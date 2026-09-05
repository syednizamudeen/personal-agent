const { Queue, Worker } = require('bullmq');
const { createRedisConnection } = require('../config/redis');
const prisma = require('../db/prisma');
const logger = require('../config/logger');
const { getSocket } = require('../services/baileysManager');

const QUEUE_NAME = 'outgoing-replies-queue';

const replyQueue = new Queue(QUEUE_NAME, { connection: createRedisConnection() });

async function enqueueOutgoingReply(payload) {
  await replyQueue.add('send-reply', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Box-Muller transform for Gaussian jitter on typing speed.
function gaussianJitter(stdDev) {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stdDev;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startReplyWorker() {
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      const { tenantId, remoteJid, messageKey, replyText, messageLogId } = job.data;

      const sock = getSocket(tenantId);
      if (!sock) {
        logger.warn({ tenantId }, 'No active WhatsApp socket for tenant, skipping reply');
        return;
      }

      // 1. Mark the source message as read.
      await sock.readMessages([messageKey]);

      // 2. Random initial delay before appearing to notice the message.
      await sleep(randomBetween(2000, 5000));

      // 3. Show "typing..." presence.
      await sock.sendPresenceUpdate('composing', remoteJid);

      // 4. Dynamic typing delay proportional to reply length, with jitter.
      const perCharMs = randomBetween(40, 70);
      const baseDelay = replyText.length * perCharMs;
      const typingDelay = Math.max(1000, Math.round(baseDelay + gaussianJitter(baseDelay * 0.15)));
      await sleep(typingDelay);

      // 5. Send the reply.
      await sock.sendMessage(remoteJid, { text: replyText });

      // 6. Reset presence.
      await sock.sendPresenceUpdate('paused', remoteJid);

      if (messageLogId) {
        await prisma.messageLog.update({
          where: { id: messageLogId },
          data: { finalReply: replyText },
        });
      }
    },
    { connection: createRedisConnection(), concurrency: 3 }
  );
}

module.exports = { replyQueue, enqueueOutgoingReply, startReplyWorker };
