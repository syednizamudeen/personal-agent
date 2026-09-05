const IORedis = require('ioredis');
const { redisUrl } = require('./env');

// BullMQ requires maxRetriesPerRequest: null on connections it owns.
function createRedisConnection() {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

module.exports = { createRedisConnection };
