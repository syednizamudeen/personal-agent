const { messageQueue } = require('../queues/messageQueue');
const { replyQueue } = require('../queues/replyQueue');
const { ollama } = require('../config/env');

async function getSystemHealth(req, res) {
  const [incomingCounts, replyCounts] = await Promise.all([
    messageQueue.getJobCounts('waiting', 'active', 'failed'),
    replyQueue.getJobCounts('waiting', 'active', 'failed'),
  ]);

  let ollamaReachable = false;
  try {
    const response = await fetch(`${ollama.baseUrl}/api/tags`);
    ollamaReachable = response.ok;
  } catch {
    ollamaReachable = false;
  }

  res.json({
    queues: {
      incomingMessages: { waiting: incomingCounts.waiting, active: incomingCounts.active, failed: incomingCounts.failed },
      outgoingReplies: { waiting: replyCounts.waiting, active: replyCounts.active, failed: replyCounts.failed },
    },
    ollama: { reachable: ollamaReachable },
  });
}

module.exports = { getSystemHealth };
