const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { sessionSecret } = require('./env');
const { createRedisConnection } = require('./redis');

function createSessionMiddleware(store) {
  return session({
    store: store || new RedisStore({ client: createRedisConnection(), prefix: 'sess:' }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}

module.exports = { createSessionMiddleware };
