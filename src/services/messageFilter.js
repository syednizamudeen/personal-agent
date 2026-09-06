const prisma = require('../db/prisma');

// WhatsApp JID suffixes that are never a one-to-one human conversation.
// Auto-replying into these is either spammy (groups) or meaningless (Status posts,
// newsletters), and classifying them burns an LLM call per item.
const GROUP_SUFFIX = '@g.us';
const BROADCAST_JIDS = ['status@broadcast'];
const NEVER_REPLY_SUFFIXES = ['@broadcast', '@newsletter'];

/**
 * Reasons a message is dropped before classification. Each maps to a SKIPPED
 * MessageLog so the decision stays visible in the audit trail.
 */
const SkipReason = {
  BROADCAST: 'BROADCAST',
  GROUP: 'GROUP',
  GROUP_NOT_MENTIONED: 'GROUP_NOT_MENTIONED',
  DIRECT_DISABLED: 'DIRECT_DISABLED',
  BLOCKED_CONTACT: 'BLOCKED_CONTACT',
  NOT_ALLOWLISTED: 'NOT_ALLOWLISTED',
  BURST_LIMIT: 'BURST_LIMIT',
  RATE_LIMITED: 'RATE_LIMITED',
};

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith(GROUP_SUFFIX);
}

function isBroadcastJid(jid) {
  if (typeof jid !== 'string') return false;
  return BROADCAST_JIDS.includes(jid) || NEVER_REPLY_SUFFIXES.some((suffix) => jid.endsWith(suffix));
}

/**
 * Structural check that needs no database access, so the caller can drop
 * broadcasts before spending a query on them.
 */
function checkJid(jid, { groupReplyMode = 'NEVER', replyToDirect = true, mentionsMe = false } = {}) {
  if (isBroadcastJid(jid)) return SkipReason.BROADCAST;

  if (isGroupJid(jid)) {
    if (groupReplyMode === 'ALWAYS') return null;
    if (groupReplyMode === 'MENTIONED_ONLY') {
      return mentionsMe ? null : SkipReason.GROUP_NOT_MENTIONED;
    }
    return SkipReason.GROUP;
  }

  return replyToDirect ? null : SkipReason.DIRECT_DISABLED;
}

async function checkContactPolicy(tenantId, jid, contactPolicy) {
  const filter = await prisma.contactFilter.findFirst({ where: { tenantId, jid } });
  if (filter?.type === 'BLOCK') return SkipReason.BLOCKED_CONTACT;
  if (contactPolicy === 'ALLOWLIST' && filter?.type !== 'ALLOW') return SkipReason.NOT_ALLOWLISTED;
  return null;
}

/**
 * Burst cap: at most `limit` auto-replies to one contact per rolling hour.
 * This is deliberately separate from rateLimitMinutes — that one enforces a single
 * reply per window, which does nothing to stop two auto-responders ping-ponging
 * once the window expires. Observed live: two tenants messaging each other
 * indefinitely, one exchange per expired window.
 */
async function checkBurstLimit(tenantId, remoteJid, limit) {
  if (!limit || limit <= 0) return null;
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.messageLog.count({
    where: { tenantId, remoteJid, status: 'AUTO_REPLIED', createdAt: { gte: since } },
  });
  return recent >= limit ? SkipReason.BURST_LIMIT : null;
}

async function checkRateLimit(tenantId, remoteJid, rateLimitMinutes) {
  const since = new Date(Date.now() - rateLimitMinutes * 60 * 1000);
  const recentReply = await prisma.messageLog.findFirst({
    where: { tenantId, remoteJid, status: 'AUTO_REPLIED', createdAt: { gte: since } },
  });
  return recentReply ? SkipReason.RATE_LIMITED : null;
}

/**
 * Runs every pre-classification gate in cost order (cheapest first) and returns the
 * first reason to skip, or null to continue to the Level 2 engine.
 */
async function shouldSkip(tenant, remoteJid, { mentionsMe = false } = {}) {
  const structural = checkJid(remoteJid, {
    groupReplyMode: tenant.groupReplyMode,
    replyToDirect: tenant.replyToDirect,
    mentionsMe,
  });
  if (structural) return structural;

  const contact = await checkContactPolicy(tenant.id, remoteJid, tenant.contactPolicy);
  if (contact) return contact;

  const rate = await checkRateLimit(tenant.id, remoteJid, tenant.rateLimitMinutes);
  if (rate) return rate;

  return checkBurstLimit(tenant.id, remoteJid, tenant.autoReplyBurstLimit);
}

module.exports = {
  SkipReason,
  isGroupJid,
  isBroadcastJid,
  checkJid,
  checkContactPolicy,
  checkBurstLimit,
  checkRateLimit,
  shouldSkip,
};
