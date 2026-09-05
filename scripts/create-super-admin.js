require('../src/config/env');
const prisma = require('../src/db/prisma');
const { hashPassword } = require('../src/services/authService');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const { email, password, name } = parseArgs();
  if (!email || !password) {
    console.error('Usage: node scripts/create-super-admin.js --email=you@example.com --password=... [--name="Your Name"]');
    process.exit(1);
  }

  const existing = await prisma.superAdmin.findUnique({ where: { email } });
  if (existing) {
    console.error(`A super-admin with email ${email} already exists.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.superAdmin.create({ data: { email, passwordHash, name: name || null } });
  console.log(`Created super-admin ${admin.email} (id: ${admin.id})`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
