const mockSendMail = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

const { sendPasswordResetEmail, sendDisconnectAlertEmail } = require('../../src/services/emailService');

describe('emailService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends a password reset email with the reset URL in the body', async () => {
    await sendPasswordResetEmail('tenant@example.com', 'https://app.example.com/reset-password?token=abc');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'tenant@example.com',
        subject: expect.stringContaining('Reset'),
        html: expect.stringContaining('https://app.example.com/reset-password?token=abc'),
      })
    );
  });

  it('sends a disconnect alert email naming the tenant', async () => {
    await sendDisconnectAlertEmail('tenant@example.com', 'Acme Tours');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'tenant@example.com',
        subject: expect.stringContaining('Disconnected'),
        html: expect.stringContaining('Acme Tours'),
      })
    );
  });
});
