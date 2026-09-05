const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Turns a Level 2 engine result into a concrete outcome: whether to reply,
 * what to reply with, and what MessageLog status to record.
 */
function resolveOutcome(level2Result) {
  if (level2Result.source === 'RULE') {
    switch (level2Result.action) {
      case 'SKIP_REPLY':
        return { status: 'SKIPPED', reply: null, category: level2Result.category };
      case 'FORCE_GREETING':
        return {
          status: 'AUTO_REPLIED',
          reply: level2Result.forcedReply || 'Thank you for your message!',
          category: level2Result.category,
        };
      case 'FORCE_CATEGORY':
        return { status: 'FLAGGED_FOR_REVIEW', reply: null, category: level2Result.category };
      default:
        return { status: 'FLAGGED_FOR_REVIEW', reply: null, category: level2Result.category };
    }
  }

  const c = level2Result.classification || {};

  if (c.isForwardedContent) {
    return { status: 'SKIPPED', reply: null };
  }

  if (!c.suggestedReply || (c.confidenceScore ?? 0) < CONFIDENCE_THRESHOLD) {
    return { status: 'FLAGGED_FOR_REVIEW', reply: null };
  }

  return { status: 'AUTO_REPLIED', reply: c.suggestedReply };
}

module.exports = { resolveOutcome, CONFIDENCE_THRESHOLD };
