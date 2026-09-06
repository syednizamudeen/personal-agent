const prisma = require('../db/prisma');

const VALID_TYPES = ['ALLOW', 'BLOCK'];

/**
 * Normalizes whatever the user typed into the JID form WhatsApp actually sends.
 * People paste "+65 9123 4567" or "6591234567"; messages arrive as
 * "6591234567@s.whatsapp.net". Anything already containing "@" is taken as-is so a
 * JID copied straight out of the message log still works.
 */
function normalizeJid(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits ? `${digits}@s.whatsapp.net` : null;
}

async function listContactFilters(tenantId, res) {
  const filters = await prisma.contactFilter.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(filters);
}

async function createContactFilter(tenantId, body, res) {
  const { jid, type, label } = body;
  const normalized = normalizeJid(jid);
  if (!normalized) return res.status(400).json({ error: 'jid is required' });
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
  }

  // One rule per contact: re-adding the same JID flips it between ALLOW and BLOCK
  // rather than failing on the unique constraint with an opaque 500.
  const filter = await prisma.contactFilter.upsert({
    where: { tenantId_jid: { tenantId, jid: normalized } },
    update: { type, label: label ?? null },
    create: { tenantId, jid: normalized, type, label: label ?? null },
  });
  res.status(201).json(filter);
}

async function deleteContactFilter(tenantId, filterId, res) {
  const { count } = await prisma.contactFilter.deleteMany({ where: { id: filterId, tenantId } });
  if (count === 0) return res.status(404).json({ error: 'Contact filter not found' });
  res.status(204).send();
}

module.exports = { normalizeJid, listContactFilters, createContactFilter, deleteContactFilter };
