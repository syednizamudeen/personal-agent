const express = require('express');
const logger = require('./config/logger');
const apiRoutes = require('./routes/api');
const { createSessionMiddleware } = require('./config/session');
const portalRoutes = require('./routes/portal');
const adminRoutes = require('./routes/admin');

// Composed Express app, kept separate from server.js so tests can boot the real
// middleware/route stack (mount order included) without binding a port.
function createApp({ sessionStore, cookieSecure } = {}) {
  const app = express();
  // The app always runs behind the nginx `web` container, which forwards
  // X-Forwarded-Proto. Without this, express-session sees every request as plain
  // HTTP and refuses to emit a Secure cookie even when TLS terminates upstream.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' })); // headroom for base64-encoded WhatsApp images
  app.use(createSessionMiddleware(sessionStore, cookieSecure === undefined ? {} : { secure: cookieSecure }));

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Order matters: '/api/v1' is a prefix of the portal/admin mounts, and routes/api.js
  // has a path-less `router.use(requireTenant)` that matches every request reaching it.
  // Mounting '/api/v1' first would 401 ('x-api-key header is required') every portal
  // and admin request before its own router ever ran. Most specific mount first.
  app.use('/api/v1/portal', portalRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1', apiRoutes);

  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled request error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
