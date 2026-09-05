const { Queue, Worker } = require('bullmq');
const { createRedisConnection } = require('../config/redis');
const prisma = require('../db/prisma');
const logger = require('../config/logger');
const { runLevel2Engine } = require('../services/level2Engine');
const { resolveOutcome } = require('../services/replyGenerator');
const { enqueueOutgoingReply } = require('./replyQueue');

const QUEUE_NAME = 'incoming-messages-queue';

const messageQueue = new Queue(QUEUE_NAME, { connection: createRedisConnection() });

async function enqueueIncomingMessage(payload) {
  await messageQueue.add('process-message', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

function startMessageWorker() {
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      const { tenantId, sessionId, remoteJid, messageType, text, mediaBase64, messageKey } = job.data;

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        logger.warn({ tenantId }, 'Tenant not found, dropping message');
        return;
      }

      if (await isRateLimited(tenantId, remoteJid, tenant.rateLimitHours)) {
        await prisma.messageLog.create({
          data: {
            tenantId,
            sessionId,
            remoteJid,
            messageType,
            rawText: text,
            mediaBase64: messageType === 'image' ? mediaBase64 : null,
            status: 'SKIPPED',
          },
        });
        return;
      }

      const level2Result = await runLevel2Engine({ tenantId, text, imageBase64: mediaBase64 });
      const outcome = resolveOutcome(level2Result);
      const classification = level2Result.classification || {};

      const log = await prisma.messageLog.create({
        data: {
          tenantId,
          sessionId,
          remoteJid,
          messageType,
          rawText: text,
          mediaBase64: messageType === 'image' ? mediaBase64 : null,
          isGreetingOrWish: classification.isGreetingOrWish ?? null,
          isForwardedContent: classification.isForwardedContent ?? null,
          confidenceScore: classification.confidenceScore ?? null,
          detectedLanguage: classification.detectedLanguage ?? null,
          suggestedReply: outcome.reply,
          finalReply: outcome.status === 'AUTO_REPLIED' ? outcome.reply : null,
          matchedRuleId: level2Result.ruleId ?? null,
          status: outcome.status,
        },
      });

      if (outcome.status === 'AUTO_REPLIED' && outcome.reply) {
        await enqueueOutgoingReply({
          tenantId,
          remoteJid,
          messageKey,
          replyText: outcome.reply,
          messageLogId: log.id,
        });
      }
    },
    { connection: createRedisConnection(), concurrency: 5 }
  );
}

async function isRateLimited(tenantId, remoteJid, rateLimitHours) {
  const since = new Date(Date.now() - rateLimitHours * 60 * 60 * 1000);
  const recentReply = await prisma.messageLog.findFirst({
    where: {
      tenantId,
      remoteJid,
      status: 'AUTO_REPLIED',
      createdAt: { gte: since },
    },
  });
  return Boolean(recentReply);
}

module.exports = { messageQueue, enqueueIncomingMessage, startMessageWorker };
