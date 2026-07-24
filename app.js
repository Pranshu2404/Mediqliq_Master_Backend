const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config/abdm.config');
const auditLogger = require('./middlewares/auditLogger');

// Preload all models used by the dedicated master process.
[
  './models/User', './models/Hospital', './models/License', './models/AuditLog',
  './models/AbdmFacility', './models/AbdmTransaction', './models/AbdmWebhookEvent',
  './models/AbdmConsent', './models/AbdmJob', './models/AbdmInternalRequest',
  './models/AbdmHiuRequest', './models/AbdmSubscription', './models/AbdmDataRelayToken'
].forEach((modelPath) => require(modelPath));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

const origins = String(process.env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || origins.length === 0 || origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  }
}));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: process.env.ABDM_CALLBACK_BODY_LIMIT || '25mb', verify(req, _res, buffer) { req.rawBody = buffer; } }));
morgan.token('safe-url', (req) => String(req.originalUrl || req.url || '').replace(/(\/hiu\/health-information\/data\/)[^/?]+/i, '$1[REDACTED]'));
app.use(morgan(':remote-addr - :method :safe-url :status :res[content-length] - :response-time ms'));

app.get('/health', (_req, res) => res.json({
  success: true, service: 'mediqliq-abdm-master', appRole: config.appRole,
  environment: config.environment, features: { m1: config.featureM1, m2: config.featureM2, m3: config.featureM3 },
  timestamp: new Date().toISOString()
}));

const adminLimiter = rateLimit({ windowMs: 60000, max: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 600), standardHeaders: true, legacyHeaders: false });
app.use('/api/mediqliq', adminLimiter, auditLogger({ apiPrefix: '/api/mediqliq' }), require('./routes/mediqliqSuperAdmin.routes'));
app.use('/api/abdm/master', adminLimiter, require('./routes/abdmMasterAdmin.routes'));

// HMAC-authenticated hospital -> master APIs for M1/M2/M3.
app.use('/internal/abdm', require('./routes/abdmInternal.routes'));

// Public ABDM callbacks. They are acknowledged quickly and processed asynchronously.
const callbackLimiter = rateLimit({
  windowMs: 60000, max: Number(process.env.ABDM_CALLBACK_RATE_LIMIT_PER_MINUTE || 3000),
  standardHeaders: true, legacyHeaders: false
});
app.use('/api/v3', callbackLimiter, require('./routes/abdmPublic.routes'));

app.use((req, res) => res.status(404).json({ success: false, error: 'Route not found' }));
app.use((err, req, res, _next) => {
  req.auditError = { message: err.message };
  console.error(err.stack || err);
  const status = Number(err.statusCode || err.status || 500);
  res.status(status).json({ success: false, error: status >= 500 ? 'Internal server error' : err.message });
});

module.exports = app;
