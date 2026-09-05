jest.mock('../../src/queues/messageQueue', () => ({
  messageQueue: { getJobCounts: jest.fn() },
}));
jest.mock('../../src/queues/replyQueue', () => ({
  replyQueue: { getJobCounts: jest.fn() },
}));

const { messageQueue } = require('../../src/queues/messageQueue');
const { replyQueue } = require('../../src/queues/replyQueue');
const { getSystemHealth } = require('../../src/controllers/adminHealthController');

global.fetch = jest.fn();

describe('getSystemHealth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports queue counts and ollama reachability', async () => {
    messageQueue.getJobCounts.mockResolvedValue({ waiting: 1, active: 0, failed: 0 });
    replyQueue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, failed: 0 });
    global.fetch.mockResolvedValue({ ok: true });

    const req = {};
    const res = { json: jest.fn() };
    await getSystemHealth(req, res);

    expect(res.json).toHaveBeenCalledWith({
      queues: {
        incomingMessages: { waiting: 1, active: 0, failed: 0 },
        outgoingReplies: { waiting: 0, active: 0, failed: 0 },
      },
      ollama: { reachable: true },
    });
  });

  it('reports ollama as unreachable when the health request fails', async () => {
    messageQueue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, failed: 0 });
    replyQueue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, failed: 0 });
    global.fetch.mockRejectedValue(new Error('connection refused'));

    const req = {};
    const res = { json: jest.fn() };
    await getSystemHealth(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ollama: { reachable: false } })
    );
  });
});
