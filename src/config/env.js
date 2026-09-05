require('dotenv').config();

const required = ['DATABASE_URL', 'REDIS_URL', 'OLLAMA_BASE_URL', 'SESSION_SECRET', 'APP_BASE_URL'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  sessionSecret: process.env.SESSION_SECRET,
  // Public origin of the web portal. Used to build password-reset links; never
  // derive these from the request's Origin header, which the caller controls.
  appBaseUrl: process.env.APP_BASE_URL.replace(/\/+$/, ''),
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL,
    model: process.env.OLLAMA_MODEL || 'gemma3:4b',
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || 'no-reply@localhost',
  },
};
