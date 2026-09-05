const prisma = require('../db/prisma');

/**
 * POST /api/v1/corrections
 * Admin flags a wrong AI reply/classification and creates a new Level 2
 * CorrectionRule so the same pattern is handled deterministically next time.
 */
async function createCorrection(req, res) {
  const tenant = req.tenant;
  const { messageLogId, pattern, isRegex, action, forcedReply, category } = req.body;

  if (!pattern || !action) {
    return res.status(400).json({ error: 'pattern and action are required' });
  }

  const validActions = ['SKIP_REPLY', 'FORCE_GREETING', 'FORCE_CATEGORY'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of ${validActions.join(', ')}` });
  }

  const rule = await prisma.correctionRule.create({
    data: {
      tenantId: tenant.id,
      pattern,
      isRegex: isRegex ?? true,
      action,
      forcedReply: forcedReply ?? null,
      category: category ?? null,
    },
  });

  if (messageLogId) {
    await prisma.messageLog.update({
      where: { id: messageLogId },
      data: { reviewedByAdmin: true },
    });
  }

  res.status(201).json(rule);
}

async function listCorrections(req, res) {
  const tenant = req.tenant;
  const rules = await prisma.correctionRule.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rules);
}

async function deleteCorrection(req, res) {
  const tenant = req.tenant;
  const { ruleId } = req.params;

  const rule = await prisma.correctionRule.findFirst({ where: { id: ruleId, tenantId: tenant.id } });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  await prisma.correctionRule.update({ where: { id: ruleId }, data: { active: false } });
  res.status(204).send();
}

module.exports = { createCorrection, listCorrections, deleteCorrection };
