const prisma = require('../db/prisma');
const { writeAuditLog } = require('../services/auditService');
const { issueResetToken } = require('../services/passwordResetService');
const { sendPasswordResetEmail } = require('../services/emailService');

async function listTenants(req, res) {
  const { limit } = req.query;
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit || '50', 10), 200),
  });
  res.json(tenants);
}

async function createTenant(req, res) {
  const { name, rateLimitHours } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const tenant = await prisma.tenant.create({ data: { name, rateLimitHours: rateLimitHours ?? 24 } });
  await writeAuditLog({
    actorType: 'SUPER_ADMIN',
    actorId: req.superAdmin.id,
    action: 'TENANT_CREATED',
    targetType: 'Tenant',
    targetId: tenant.id,
    tenantId: tenant.id,
    afterData: tenant,
  });
  res.status(201).json(tenant);
}

async function getTenant(req, res) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(tenant);
}

async function updateTenant(req, res) {
  const existing = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Tenant not found' });

  const { name, rateLimitHours, status } = req.body;
  const data = {};
  const beforeData = {};
  const afterData = {};

  if (name !== undefined) {
    data.name = name;
    beforeData.name = existing.name;
  }
  if (rateLimitHours !== undefined) {
    data.rateLimitHours = rateLimitHours;
    beforeData.rateLimitHours = existing.rateLimitHours;
  }
  if (status !== undefined) {
    data.status = status;
    beforeData.status = existing.status;
  }

  const updated = await prisma.tenant.update({ where: { id: req.params.id }, data });

  if (name !== undefined) afterData.name = updated.name;
  if (rateLimitHours !== undefined) afterData.rateLimitHours = updated.rateLimitHours;
  if (status !== undefined) afterData.status = updated.status;

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
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant?.loginEmail) return res.status(400).json({ error: 'Tenant has no login email set' });

  const token = await issueResetToken('TENANT', tenant.id);
  const resetUrl = `${req.headers.origin || ''}/portal/reset-password?token=${token}`;
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
