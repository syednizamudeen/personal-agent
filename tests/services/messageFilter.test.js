jest.mock('../../src/db/prisma', () => ({
  contactFilter: { findFirst: jest.fn() },
  messageLog: { count: jest.fn(), findFirst: jest.fn() },
}));

const prisma = require('../../src/db/prisma');
const { SkipReason, checkJid, checkContactPolicy, checkBurstLimit, shouldSkip } = require('../../src/services/messageFilter');

const TENANT = {
  id: 't1',
  replyToDirect: true,
  groupReplyMode: 'NEVER',
  contactPolicy: 'ALL',
  rateLimitMinutes: 1440,
  autoReplyBurstLimit: 5,
};

const GROUP = '120363022069470445@g.us';
const DIRECT = '6591234567@s.whatsapp.net';

describe('checkJid', () => {
  it('always skips WhatsApp Status broadcasts', () => {
    // These were reaching the LLM and burning a classification per Status post.
    expect(checkJid('status@broadcast', { groupReplyMode: 'ALWAYS' })).toBe(SkipReason.BROADCAST);
  });

  it('skips newsletters regardless of the group setting', () => {
    expect(checkJid('12345@newsletter', { groupReplyMode: 'ALWAYS' })).toBe(SkipReason.BROADCAST);
  });

  it('skips group chats by default', () => {
    expect(checkJid(GROUP, {})).toBe(SkipReason.GROUP);
  });

  it('replies to every group message under ALWAYS', () => {
    expect(checkJid(GROUP, { groupReplyMode: 'ALWAYS', mentionsMe: false })).toBeNull();
  });

  it('replies in a group under MENTIONED_ONLY when mentioned', () => {
    expect(checkJid(GROUP, { groupReplyMode: 'MENTIONED_ONLY', mentionsMe: true })).toBeNull();
  });

  it('stays silent in a group under MENTIONED_ONLY when not mentioned', () => {
    expect(checkJid(GROUP, { groupReplyMode: 'MENTIONED_ONLY', mentionsMe: false })).toBe(
      SkipReason.GROUP_NOT_MENTIONED
    );
  });

  it('allows an ordinary one-to-one chat', () => {
    expect(checkJid(DIRECT, {})).toBeNull();
  });

  it('skips direct messages when replyToDirect is off', () => {
    expect(checkJid(DIRECT, { replyToDirect: false })).toBe(SkipReason.DIRECT_DISABLED);
  });

  it('does not let a group mention bypass the direct-message switch, or vice versa', () => {
    // Group setting must not leak into 1-to-1 handling.
    expect(checkJid(DIRECT, { groupReplyMode: 'ALWAYS', replyToDirect: false })).toBe(SkipReason.DIRECT_DISABLED);
    expect(checkJid(GROUP, { groupReplyMode: 'NEVER', replyToDirect: true, mentionsMe: true })).toBe(SkipReason.GROUP);
  });
});

describe('checkContactPolicy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocks a contact with a BLOCK filter even under the ALL policy', async () => {
    prisma.contactFilter.findFirst.mockResolvedValue({ type: 'BLOCK' });
    expect(await checkContactPolicy('t1', 'x@s.whatsapp.net', 'ALL')).toBe(SkipReason.BLOCKED_CONTACT);
  });

  it('allows an unlisted contact under the ALL policy', async () => {
    prisma.contactFilter.findFirst.mockResolvedValue(null);
    expect(await checkContactPolicy('t1', 'x@s.whatsapp.net', 'ALL')).toBeNull();
  });

  it('skips an unlisted contact under the ALLOWLIST policy', async () => {
    prisma.contactFilter.findFirst.mockResolvedValue(null);
    expect(await checkContactPolicy('t1', 'x@s.whatsapp.net', 'ALLOWLIST')).toBe(SkipReason.NOT_ALLOWLISTED);
  });

  it('allows an ALLOW-listed contact under the ALLOWLIST policy', async () => {
    prisma.contactFilter.findFirst.mockResolvedValue({ type: 'ALLOW' });
    expect(await checkContactPolicy('t1', 'x@s.whatsapp.net', 'ALLOWLIST')).toBeNull();
  });
});

// The runaway that motivated this: two tenants auto-replying to each other, one
// exchange every time rateLimitMinutes expired. The rate limit alone cannot stop it.
describe('checkBurstLimit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stops replying once the hourly cap is reached', async () => {
    prisma.messageLog.count.mockResolvedValue(5);
    expect(await checkBurstLimit('t1', 'peer@s.whatsapp.net', 5)).toBe(SkipReason.BURST_LIMIT);
  });

  it('allows a reply below the cap', async () => {
    prisma.messageLog.count.mockResolvedValue(4);
    expect(await checkBurstLimit('t1', 'peer@s.whatsapp.net', 5)).toBeNull();
  });

  it('is disabled when the limit is zero', async () => {
    expect(await checkBurstLimit('t1', 'peer@s.whatsapp.net', 0)).toBeNull();
    expect(prisma.messageLog.count).not.toHaveBeenCalled();
  });
});

describe('shouldSkip ordering', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a broadcast without touching the database', async () => {
    expect(await shouldSkip(TENANT, 'status@broadcast')).toBe(SkipReason.BROADCAST);
    expect(prisma.contactFilter.findFirst).not.toHaveBeenCalled();
    expect(prisma.messageLog.findFirst).not.toHaveBeenCalled();
  });

  it('passes a normal message through every gate', async () => {
    prisma.contactFilter.findFirst.mockResolvedValue(null);
    prisma.messageLog.findFirst.mockResolvedValue(null);
    prisma.messageLog.count.mockResolvedValue(0);
    expect(await shouldSkip(TENANT, '6591234567@s.whatsapp.net')).toBeNull();
  });

  it('reports the rate limit before spending a burst-limit query', async () => {
    prisma.contactFilter.findFirst.mockResolvedValue(null);
    prisma.messageLog.findFirst.mockResolvedValue({ id: 'recent' });
    expect(await shouldSkip(TENANT, '6591234567@s.whatsapp.net')).toBe(SkipReason.RATE_LIMITED);
    expect(prisma.messageLog.count).not.toHaveBeenCalled();
  });
});
