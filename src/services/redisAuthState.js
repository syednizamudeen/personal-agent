const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

/**
 * Redis-backed replacement for Baileys' useMultiFileAuthState, so each tenant's
 * WhatsApp session survives worker restarts without writing to local disk
 * (required for horizontally-scaled, stateless session-manager workers).
 */
async function useRedisAuthState(redis, tenantId) {
  const credsKey = `tenant:${tenantId}:auth:creds`;
  const keysHash = `tenant:${tenantId}:auth:keys`;

  const readCreds = async () => {
    const raw = await redis.get(credsKey);
    return raw ? JSON.parse(raw, BufferJSON.reviver) : initAuthCreds();
  };

  const writeCreds = async (creds) => {
    await redis.set(credsKey, JSON.stringify(creds, BufferJSON.replacer));
  };

  let creds = await readCreds();

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        const pipeline = redis.pipeline();
        const fields = ids.map((id) => `${type}-${id}`);
        fields.forEach((field) => pipeline.hget(keysHash, field));
        const results = await pipeline.exec();
        ids.forEach((id, index) => {
          const [, raw] = results[index];
          if (raw) {
            data[id] = JSON.parse(raw, BufferJSON.reviver);
          }
        });
        return data;
      },
      set: async (data) => {
        const pipeline = redis.pipeline();
        let hasWrites = false;
        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type])) {
            hasWrites = true;
            const field = `${type}-${id}`;
            const value = data[type][id];
            if (value) {
              pipeline.hset(keysHash, field, JSON.stringify(value, BufferJSON.replacer));
            } else {
              pipeline.hdel(keysHash, field);
            }
          }
        }
        if (hasWrites) await pipeline.exec();
      },
    },
  };

  return {
    state,
    saveCreds: () => writeCreds(state.creds),
  };
}

async function clearAuthState(redis, tenantId) {
  await redis.del(`tenant:${tenantId}:auth:creds`, `tenant:${tenantId}:auth:keys`);
}

module.exports = { useRedisAuthState, clearAuthState };
