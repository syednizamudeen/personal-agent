const express = require('express');
const { port } = require('./config/env');
const logger = require('./config/logger');
const apiRoutes = require('./routes/api');
const { createSessionMiddleware } = require('./config/session');
const portalRoutes = require('./routes/portal');
const adminRoutes = require('./routes/admin');
const { startMessageWorker } = require('./queues/messageQueue');
const { startReplyWorker } = require('./queues/replyQueue');
const { resumeActiveSessions } = require('./services/baileysManager');

const app = express();
app.use(express.json({ limit: '15mb' })); // headroom for base64-encoded WhatsApp images
app.use(createSessionMiddleware());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/v1', apiRoutes);
app.use('/api/v1/portal', portalRoutes);
app.use('/api/v1/admin', adminRoutes);

app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled request error');
  res.status(500).json({ error: 'Internal server error' });
});

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
