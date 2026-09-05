const pino = require('pino');
const { logLevel } = require('./env');

module.exports = pino({ level: logLevel });
