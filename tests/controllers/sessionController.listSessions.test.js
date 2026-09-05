jest.mock('../../src/db/prisma', () => ({
  whatsAppSession: { findMany: jest.fn() },
}));

jest.mock('../../src/services/baileysManager', () => ({
  startSession: jest.fn(),
}));

const prisma = require('../../src/db/prisma');
const { listSessions } = require('../../src/controllers/sessionController');

describe('listSessions', () => {
  it('maps sessions to id/status/phoneNumber/qrCode, hiding qrCode unless PENDING_QR', async () => {
    prisma.whatsAppSession.findMany.mockResolvedValue([
      { id: 's1', status: 'CONNECTED', phoneNumber: '123', qrCode: 'data:old' },
      { id: 's2', status: 'PENDING_QR', phoneNumber: null, qrCode: 'data:new' },
    ]);
    const req = { tenant: { id: 't1' } };
    const res = { json: jest.fn() };
    await listSessions(req, res);
    expect(res.json).toHaveBeenCalledWith([
      { sessionId: 's1', status: 'CONNECTED', phoneNumber: '123', qrCode: null },
      { sessionId: 's2', status: 'PENDING_QR', phoneNumber: null, qrCode: 'data:new' },
    ]);
  });
});
