const { buildSystemPrompt } = require('../../src/services/ollamaClient');

// Regression: the original prompt described only the classification task and gave the
// model no identity, so "what is your name" was answered with the model's own name
// ("Hi there! I'm Gemma, a large language model...") and sent to a real contact.
describe('buildSystemPrompt', () => {
  const TENANT = {
    assistantName: 'Aria',
    ownerName: 'Nizam',
    businessInfo: 'Runs a BBQ catering business in Singapore.',
    personaInstructions: 'Always confirm the event date before quoting.',
  };

  it('states the assistant identity and who it represents', () => {
    const prompt = buildSystemPrompt(TENANT, 'Sarah');
    expect(prompt).toContain('You are Aria');
    expect(prompt).toContain('on behalf of Nizam');
    expect(prompt).toContain('Runs a BBQ catering business in Singapore.');
    expect(prompt).toContain('Always confirm the event date before quoting.');
  });

  it('forbids disclosing the underlying model', () => {
    const prompt = buildSystemPrompt(TENANT, 'Sarah');
    expect(prompt).toMatch(/Never reveal that you are an AI/i);
    expect(prompt).toMatch(/If asked your name, answer "Aria"/);
  });

  it('passes the sender name through for personalization', () => {
    expect(buildSystemPrompt(TENANT, 'Sarah')).toContain('replying to Sarah');
  });

  it('tells the model not to invent a name when the sender is unknown', () => {
    const prompt = buildSystemPrompt(TENANT, null);
    expect(prompt).not.toContain('replying to');
    expect(prompt).toMatch(/do not guess or invent one/i);
  });

  it('degrades to a generic voice for an unconfigured tenant', () => {
    const prompt = buildSystemPrompt({}, null);
    expect(prompt).toContain('You are a WhatsApp assistant');
    expect(prompt).toMatch(/Never reveal that you are an AI/i);
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('null');
  });

  it('falls back to the owner name when no assistant name is set', () => {
    const prompt = buildSystemPrompt({ ownerName: 'Nizam' }, null);
    expect(prompt).toContain('on behalf of Nizam');
    expect(prompt).toMatch(/If asked your name, answer "Nizam"/);
  });

  it('always includes the JSON schema the parser depends on', () => {
    expect(buildSystemPrompt({}, null)).toContain('"suggestedReply"');
  });
});
