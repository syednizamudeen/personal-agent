const { ollama } = require('../config/env');
const logger = require('../config/logger');

const SYSTEM_PROMPT = `You are a WhatsApp message classifier for a Singapore/SEA-based business.
Analyze the user's message (and image, if provided) and respond with ONLY a JSON object
matching this exact schema, no extra text:
{
  "isGreetingOrWish": boolean,
  "isForwardedContent": boolean,
  "confidenceScore": number,
  "detectedLanguage": "ENGLISH" | "SINGLISH" | "TAMIL" | "MALAY" | "CHINESE" | "OTHER",
  "suggestedReply": "a short, warm, localized reply, max 2 sentences"
}`;

/**
 * Calls Ollama in JSON mode with the given text/image payload and returns the
 * parsed classification object.
 */
async function classifyWithOllama({ text, imageBase64 }) {
  const payload = {
    model: ollama.model,
    system: SYSTEM_PROMPT,
    prompt: text || '(no text, image only)',
    format: 'json',
    stream: false,
  };
  if (imageBase64) {
    payload.images = [imageBase64];
  }

  const res = await fetch(`${ollama.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();

  try {
    return JSON.parse(data.response);
  } catch (err) {
    logger.error({ raw: data.response }, 'Failed to parse Ollama JSON response');
    return {
      isGreetingOrWish: false,
      isForwardedContent: false,
      confidenceScore: 0,
      detectedLanguage: 'OTHER',
      suggestedReply: null,
    };
  }
}

module.exports = { classifyWithOllama };
