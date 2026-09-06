const session = require('express-session');
const connectRedis = require('connect-redis');
const { sessionSecret, sessionCookieSecure } = require('./env');
const { createRedisConnection } = require('./redis');

const RedisStore = connectRedis(session);

function createSessionMiddleware(store, { secure = sessionCookieSecure } = {}) {
  return session({
    store: store || new RedisStore({ client: createRedisConnection(), prefix: 'sess:' }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}

module.exports = { createSessionMiddleware };
