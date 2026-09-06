const { baseId, mentionsMe, extractMentionedJids } = require('../../src/services/mentionDetector');

// The socket's own id carries a device suffix; mentions never do. LID addressing gives
// the same account a second, unrelated identifier. All three must compare equal.
const USER = { id: '6581077109:57@s.whatsapp.net', lid: '208241522929689@lid' };

describe('baseId', () => {
  it('strips the device suffix from a socket id', () => {
    expect(baseId('6581077109:57@s.whatsapp.net')).toBe('6581077109');
  });

  it('strips the domain from a plain jid', () => {
    expect(baseId('6581077109@s.whatsapp.net')).toBe('6581077109');
  });

  it('handles lid addressing', () => {
    expect(baseId('208241522929689@lid')).toBe('208241522929689');
  });

  it('returns null for non-strings', () => {
    expect(baseId(undefined)).toBeNull();
    expect(baseId(null)).toBeNull();
  });
});

describe('extractMentionedJids', () => {
  it('reads mentions off a media caption, not just a text message', () => {
    const message = { imageMessage: { contextInfo: { mentionedJid: ['6581077109@s.whatsapp.net'] } } };
    expect(extractMentionedJids(message)).toEqual(['6581077109@s.whatsapp.net']);
  });

  it('returns an empty array when there is no context', () => {
    expect(extractMentionedJids({ conversation: 'hi' })).toEqual([]);
    expect(extractMentionedJids(null)).toEqual([]);
  });
});

describe('mentionsMe', () => {
  it('matches a mention of the phone-number jid despite the device suffix', () => {
    const message = { extendedTextMessage: { contextInfo: { mentionedJid: ['6581077109@s.whatsapp.net'] } } };
    expect(mentionsMe(message, USER)).toBe(true);
  });

  it('matches a mention that uses lid addressing', () => {
    const message = { extendedTextMessage: { contextInfo: { mentionedJid: ['208241522929689@lid'] } } };
    expect(mentionsMe(message, USER)).toBe(true);
  });

  it('ignores a mention of somebody else', () => {
    const message = { extendedTextMessage: { contextInfo: { mentionedJid: ['6599999999@s.whatsapp.net'] } } };
    expect(mentionsMe(message, USER)).toBe(false);
  });

  it('treats a quoted reply to our own message as addressing us', () => {
    const message = {
      extendedTextMessage: { contextInfo: { participant: '6581077109:12@s.whatsapp.net' } },
    };
    expect(mentionsMe(message, USER)).toBe(true);
  });

  it('is false for a plain group message with no mentions', () => {
    expect(mentionsMe({ conversation: 'anyone free tonight?' }, USER)).toBe(false);
  });

  it('is false when the socket has no identity yet', () => {
    const message = { extendedTextMessage: { contextInfo: { mentionedJid: ['6581077109@s.whatsapp.net'] } } };
    expect(mentionsMe(message, undefined)).toBe(false);
  });
});
