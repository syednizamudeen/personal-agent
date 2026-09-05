const session = require('express-session');
const { createSessionMiddleware } = require('../../src/config/session');

describe('createSessionMiddleware', () => {
  it('returns an express-session middleware using the provided store', () => {
    const store = new session.MemoryStore();
    const middleware = createSessionMiddleware(store);
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
  });
});
