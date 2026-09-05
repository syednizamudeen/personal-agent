const { port } = require('./config/env');
const logger = require('./config/logger');
const { createApp } = require('./app');
const { startMessageWorker } = require('./queues/messageQueue');
const { startReplyWorker } = require('./queues/replyQueue');
const { resumeActiveSessions } = require('./services/baileysManager');

// Defense in depth: an async handler that escapes its try/catch (or a rejected
// promise outside the request lifecycle) should be logged, not silently crash
// the process on Node's default unhandled-rejection behaviour.
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection');
});

const app = createApp();

app.listen(port, () => {
  logger.info({ port }, 'Admin API listening');
});

// Workers run in the same process for simplicity; scale out by running this
// entry point in multiple containers behind the shared Redis/Postgres.
startMessageWorker();
startReplyWorker();

logger.info('BullMQ workers started (incoming-messages-queue, outgoing-replies-queue)');

resumeActiveSessions().catch((err) => {
  logger.error({ err }, 'Failed to resume active WhatsApp sessions on boot');
});
