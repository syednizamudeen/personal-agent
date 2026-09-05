const prisma = require('../db/prisma');
const logger = require('../config/logger');
const { classifyWithOllama } = require('./ollamaClient');

/**
 * Level 2 Human-in-the-Loop Rule Engine.
 *
 * Step A: check tenant CorrectionRules for a hard pattern match. If one matches,
 * bypass the LLM entirely and return the forced action/category.
 * Step B: fall back to Ollama vision/text classification.
 */

/**
 * @returns {{ source: 'RULE'|'LLM', action?: string, category?: string, forcedReply?: string,
 *             ruleId?: string, classification?: object }}
 */
async function runLevel2Engine({ tenantId, text, imageBase64 }) {
  const ruleMatch = await matchCorrectionRule(tenantId, text);
  if (ruleMatch) {
    logger.info({ tenantId, ruleId: ruleMatch.id }, 'Level2: hard rule matched, bypassing LLM');
    return {
      source: 'RULE',
      action: ruleMatch.action,
      category: ruleMatch.category,
      forcedReply: ruleMatch.forcedReply,
      ruleId: ruleMatch.id,
    };
  }

  const classification = await classifyWithOllama({ text, imageBase64 });
  return { source: 'LLM', classification };
}

/**
 * Step A: exact pattern / hard rule match against the tenant's active CorrectionRules.
 * Returns the first matching rule, or null.
 */
async function matchCorrectionRule(tenantId, text) {
  if (!text) return null;

  const rules = await prisma.correctionRule.findMany({
    where: { tenantId, active: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const rule of rules) {
    if (ruleMatches(rule, text)) {
      return rule;
    }
  }
  return null;
}

function ruleMatches(rule, text) {
  if (!rule.isRegex) {
    return text.toLowerCase().includes(rule.pattern.toLowerCase());
  }
  try {
    const regex = new RegExp(rule.pattern, 'i');
    return regex.test(text);
  } catch (err) {
    logger.warn({ ruleId: rule.id, err: err.message }, 'Invalid regex in CorrectionRule, skipping');
    return false;
  }
}

module.exports = { runLevel2Engine, matchCorrectionRule, ruleMatches };
