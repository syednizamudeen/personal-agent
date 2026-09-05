const express = require('express');
const request = require('supertest');
const asyncHandler = require('../../src/middleware/asyncHandler');

describe('asyncHandler', () => {
  it('forwards a rejected promise to next()', async () => {
    const boom = new Error('boom');
    const next = jest.fn();
    await asyncHandler(async () => {
      throw boom;
    })({}, {}, next);
    expect(next).toHaveBeenCalledWith(boom);
  });

  // A synchronous throw propagates synchronously out of the wrapper; Express
  // already catches those itself, so it is deliberately left alone here.
  it('lets a synchronous throw propagate to Express', () => {
    const next = jest.fn();
    expect(() =>
      asyncHandler(() => {
        throw new Error('sync boom');
      })({}, {}, next)
    ).toThrow('sync boom');
    expect(next).not.toHaveBeenCalled();
  });

  it('does not call next() when the handler resolves', async () => {
    const next = jest.fn();
    const res = { json: jest.fn() };
    await asyncHandler(async (req, r) => r.json({ ok: true }))({}, res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a rejection reach the Express error handler instead of becoming unhandled', async () => {
    const app = express();
    app.get(
      '/boom',
      asyncHandler(async () => {
        throw new Error('db exploded');
      })
    );
    app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error' }));

    const rejections = [];
    const onRejection = (err) => rejections.push(err);
    process.on('unhandledRejection', onRejection);
    try {
      const res = await request(app).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
