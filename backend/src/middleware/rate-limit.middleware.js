const rateLimit = require('express-rate-limit');

const formLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

module.exports = { formLimiter, authLimiter, adminLoginLimiter };
