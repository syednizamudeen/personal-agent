const messageFilter = require('../services/messageFilter');
const { runLevel2Engine } = require('../services/level2Engine');
const { resolveOutcome } = require('../services/replyGenerator');

const DEFAULT_TEST_JID = 'dev-test@s.whatsapp.net';

/**
 * Runs a message through the real inbound pipeline (filter -> Level 2 engine ->
 * outcome resolution) using the tenant's actual settings, and returns the result
 * synchronously. No MessageLog row, no queue job, no WhatsApp send — this exists
 * so a tenant can see what the assistant would do without a live phone to test with.
 */
async function testMessage(req, res) {
  const tenant = req.tenant;
  const { message, remoteJid, senderName, mentionsMe } = req.body;

  if (!message) return res.status(400).json({ error: 'message is required' });

  const jid = remoteJid || DEFAULT_TEST_JID;

  const skipReason = await messageFilter.shouldSkip(tenant, jid, { mentionsMe: !!mentionsMe });
  if (skipReason) {
    return res.json({ status: 'SKIPPED', skipReason, reply: null });
  }

  const level2Result = await runLevel2Engine({
    tenantId: tenant.id,
    tenant,
    senderName: senderName || null,
    text: message,
  });

  const outcome = resolveOutcome(level2Result, tenant);

  res.json({
    status: outcome.status,
    reply: outcome.reply,
    category: outcome.category ?? level2Result.category ?? null,
    source: level2Result.source,
    classification: level2Result.classification ?? null,
  });
}

module.exports = { testMessage };
