/**
 * Reduces a WhatsApp JID to the bare account identifier used for comparison.
 *
 * The same account appears in several shapes: the socket's own id carries a device
 * suffix ("6581077109:57@s.whatsapp.net"), mentions arrive as plain JIDs
 * ("6581077109@s.whatsapp.net"), and WhatsApp's newer LID addressing uses an opaque
 * number on "@lid" instead of the phone number. Stripping the device suffix and the
 * domain leaves the one part that is stable across all of them.
 */
function baseId(jid) {
  if (typeof jid !== 'string') return null;
  const withoutDomain = jid.split('@')[0];
  const withoutDevice = withoutDomain.split(':')[0];
  return withoutDevice || null;
}

/**
 * Every identifier that means "this account". A socket has a phone-number id and,
 * on newer WhatsApp versions, a separate LID — a mention may use either.
 */
function ownIdentifiers(user) {
  return new Set([baseId(user?.id), baseId(user?.lid)].filter(Boolean));
}

/**
 * Pulls the mentioned JIDs out of a message. WhatsApp puts them on contextInfo,
 * which hangs off whichever message variant was sent, so check each one rather than
 * assuming extendedTextMessage.
 */
function extractMentionedJids(message) {
  if (!message) return [];
  const contexts = [
    message.extendedTextMessage?.contextInfo,
    message.imageMessage?.contextInfo,
    message.videoMessage?.contextInfo,
    message.documentMessage?.contextInfo,
    message.audioMessage?.contextInfo,
    message.stickerMessage?.contextInfo,
  ];
  const jids = [];
  for (const ctx of contexts) {
    if (Array.isArray(ctx?.mentionedJid)) jids.push(...ctx.mentionedJid);
  }
  return jids;
}

/**
 * True when the message @-mentions this socket's own account, or is a direct reply
 * to one of its messages (WhatsApp treats a quoted reply as addressing you, and
 * users reasonably expect the assistant to answer it).
 */
function mentionsMe(message, user) {
  const mine = ownIdentifiers(user);
  if (mine.size === 0) return false;

  for (const jid of extractMentionedJids(message)) {
    const id = baseId(jid);
    if (id && mine.has(id)) return true;
  }

  const quotedParticipant =
    message?.extendedTextMessage?.contextInfo?.participant ||
    message?.imageMessage?.contextInfo?.participant;
  const quotedId = baseId(quotedParticipant);
  return Boolean(quotedId && mine.has(quotedId));
}

module.exports = { baseId, ownIdentifiers, extractMentionedJids, mentionsMe };
