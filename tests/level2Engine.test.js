jest.mock('../src/db/prisma', () => ({
  correctionRule: { findMany: jest.fn() },
}));
jest.mock('../src/services/ollamaClient', () => ({
  classifyWithOllama: jest.fn(),
}));

const prisma = require('../src/db/prisma');
const { classifyWithOllama } = require('../src/services/ollamaClient');
const { runLevel2Engine } = require('../src/services/level2Engine');

describe('Level 2 Rule Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bypasses the LLM and returns the forced action when a hard rule matches', async () => {
    prisma.correctionRule.findMany.mockResolvedValue([
      {
        id: 'rule-1',
        pattern: 'condolences|passed away|rip',
        isRegex: true,
        action: 'SKIP_REPLY',
        category: 'BEREAVEMENT',
        forcedReply: null,
      },
    ]);

    const result = await runLevel2Engine({
      tenantId: 'tenant-1',
      text: 'So sorry for your loss, my condolences to the family',
    });

    expect(result.source).toBe('RULE');
    expect(result.action).toBe('SKIP_REPLY');
    expect(result.ruleId).toBe('rule-1');
    expect(classifyWithOllama).not.toHaveBeenCalled();
  });

  it('falls back to the LLM when no rule matches', async () => {
    prisma.correctionRule.findMany.mockResolvedValue([
      { id: 'rule-1', pattern: 'condolences', isRegex: true, action: 'SKIP_REPLY', category: null, forcedReply: null },
    ]);
    classifyWithOllama.mockResolvedValue({
      isGreetingOrWish: true,
      isForwardedContent: false,
      confidenceScore: 0.9,
      detectedLanguage: 'ENGLISH',
      suggestedReply: 'Thank you, happy holidays to you too!',
    });

    const result = await runLevel2Engine({ tenantId: 'tenant-1', text: 'Happy new year!' });

    expect(result.source).toBe('LLM');
    expect(classifyWithOllama).toHaveBeenCalledWith({ text: 'Happy new year!', imageBase64: undefined });
    expect(result.classification.suggestedReply).toContain('happy holidays');
  });

  it('an inactive/non-matching regex rule does not block the LLM fallback', async () => {
    prisma.correctionRule.findMany.mockResolvedValue([]);
    classifyWithOllama.mockResolvedValue({ suggestedReply: 'ok', confidenceScore: 0.8 });

    const result = await runLevel2Engine({ tenantId: 'tenant-1', text: 'random message' });

    expect(result.source).toBe('LLM');
  });

  it('gracefully skips a rule with an invalid regex instead of throwing', async () => {
    prisma.correctionRule.findMany.mockResolvedValue([
      { id: 'bad-rule', pattern: '(unterminated', isRegex: true, action: 'SKIP_REPLY' },
    ]);
    classifyWithOllama.mockResolvedValue({ suggestedReply: 'ok', confidenceScore: 0.8 });

    const result = await runLevel2Engine({ tenantId: 'tenant-1', text: 'hello' });

    expect(result.source).toBe('LLM');
  });
});
