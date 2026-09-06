const prisma = require('../db/prisma');
const { writeAuditLog } = require('../services/auditService');
const { issueResetToken } = require('../services/passwordResetService');
const { sendPasswordResetEmail } = require('../services/emailService');
const { appBaseUrl } = require('../config/env');

// passwordHash must never leave the server. apiKey stays: it is the credential a
// super-admin hands to the tenant, and these routes are super-admin-only.
const TENANT_PUBLIC_SELECT = {
  id: true,
  name: true,
  apiKey: true,
  rateLimitMinutes: true,
  assistantName: true,
  ownerName: true,
  businessInfo: true,
  personaInstructions: true,
  replyToDirect: true,
  groupReplyMode: true,
  greetingsOnly: true,
  contactPolicy: true,
  autoReplyBurstLimit: true,
  loginEmail: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

const RATE_LIMIT_ERROR = 'rateLimitMinutes must be a positive integer';
const CONTACT_POLICIES = ['ALL', 'ALLOWLIST'];
const BOOLEAN_FIELDS = ['replyToDirect', 'greetingsOnly'];
const GROUP_REPLY_MODES = ['NEVER', 'MENTIONED_ONLY', 'ALWAYS'];
// Everything a super-admin may PATCH. apiKey/passwordHash are deliberately absent.
const EDITABLE_FIELDS = [
  'name',
  'rateLimitMinutes',
  'status',
  'loginEmail',
  'assistantName',
  'ownerName',
  'businessInfo',
  'personaInstructions',
  'contactPolicy',
  'groupReplyMode',
  'autoReplyBurstLimit',
  ...BOOLEAN_FIELDS,
];

// The column is a Postgres INTEGER; a float or a string would either be silently
// truncated by Prisma or blow up as a 500 at the driver, so reject both here.
function isValidRateLimit(value) {
  return Number.isInteger(value) && value > 0;
}

async function listTenants(req, res) {
  const { limit } = req.query;
  const tenants = await prisma.tenant.findMany({
    select: TENANT_PUBLIC_SELECT,
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit || '50', 10), 200),
  });
  res.json(tenants);
}

async function createTenant(req, res) {
  const { name, rateLimitMinutes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (rateLimitMinutes !== undefined && !isValidRateLimit(rateLimitMinutes)) {
    return res.status(400).json({ error: RATE_LIMIT_ERROR });
  }

  const tenant = await prisma.tenant.create({
    data: { name, rateLimitMinutes: rateLimitMinutes ?? 1440 },
    select: TENANT_PUBLIC_SELECT,
  });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'TENANT_CREATED',
    targetType: 'Tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    // Field-picked: the raw row carries apiKey (and could carry passwordHash),
    // and audit logs are readable by every super-admin via GET /admin/audit-logs.
    afterData: { name: tenant.name, rateLimitMinutes: tenant.rateLimitMinutes },
  });
  res.status(201).json(tenant);
}

async function getTenant(req, res) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    select: TENANT_PUBLIC_SELECT,
  });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(tenant);
}

async function updateTenant(req, res) {
  const existing = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    select: TENANT_PUBLIC_SELECT,
  });
  if (!existing) return res.status(404).json({ error: 'Tenant not found' });

  const { status, rateLimitMinutes, contactPolicy, autoReplyBurstLimit, groupReplyMode } = req.body;

  const validStatuses = ['ACTIVE', 'SUSPENDED'];
  if (status !== undefined && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${validStatuses.join(', ')}` });
  }
  if (rateLimitMinutes !== undefined && !isValidRateLimit(rateLimitMinutes)) {
    return res.status(400).json({ error: RATE_LIMIT_ERROR });
  }
  if (autoReplyBurstLimit !== undefined && !isValidRateLimit(autoReplyBurstLimit)) {
    return res.status(400).json({ error: 'autoReplyBurstLimit must be a positive integer' });
  }
  if (contactPolicy !== undefined && !CONTACT_POLICIES.includes(contactPolicy)) {
    return res.status(400).json({ error: `contactPolicy must be one of ${CONTACT_POLICIES.join(', ')}` });
  }
  if (groupReplyMode !== undefined && !GROUP_REPLY_MODES.includes(groupReplyMode)) {
    return res.status(400).json({ error: `groupReplyMode must be one of ${GROUP_REPLY_MODES.join(', ')}` });
  }

  const data = {};
  const beforeData = {};
  const afterData = {};

  // Copy only the fields the caller actually sent, so a PATCH never blanks a field it
  // did not mention, and audit before/after stay narrow (see writeAuditLog convention).
  for (const field of EDITABLE_FIELDS) {
    const value = req.body[field];
    if (value === undefined) continue;
    if (BOOLEAN_FIELDS.includes(field) && typeof value !== 'boolean') {
      return res.status(400).json({ error: `${field} must be a boolean` });
    }
    data[field] = value;
    beforeData[field] = existing[field];
  }

  const updated = await prisma.tenant.update({
    where: { id: req.params.id },
    data,
    select: TENANT_PUBLIC_SELECT,
  });

  for (const field of Object.keys(data)) {
    afterData[field] = updated[field];
  }

  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'TENANT_UPDATED',
    targetType: 'Tenant',
    targetId: existing.id,
    tenantId: existing.id,
    beforeData,
    afterData,
  });
  res.json(updated);
}

async function sendTenantPasswordReset(req, res) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    select: { id: true, loginEmail: true },
  });
  if (!tenant?.loginEmail) return res.status(400).json({ error: 'Tenant has no login email set' });

  const token = await issueResetToken('TENANT', tenant.id);
  const resetUrl = `${appBaseUrl}/portal/reset-password?token=${token}`;
  await sendPasswordResetEmail(tenant.loginEmail, resetUrl);
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'TENANT_PASSWORD_RESET_TRIGGERED',
    targetType: 'Tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
  });
  res.json({ ok: true });
}

module.exports = { listTenants, createTenant, getTenant, updateTenant, sendTenantPasswordReset };
