require('dotenv').config();
const crypto = require('crypto');
const config = require('../config/abdm.config');
const errors=[]; const warnings=[];
if (process.env.APP_ROLE && process.env.APP_ROLE !== 'ABDM_MASTER') errors.push('APP_ROLE must be ABDM_MASTER');
for (const key of ['MONGO_URI','JWT_SECRET','ABDM_CLIENT_ID','ABDM_CLIENT_SECRET','ABDM_BRIDGE_ID','ABDM_MASTER_ENCRYPTION_KEY']) if (!process.env[key]) errors.push(`${key} is required`);
if ((process.env.JWT_SECRET||'').length < 32) errors.push('JWT_SECRET must contain at least 32 characters');
if ((process.env.ABDM_MASTER_ENCRYPTION_KEY||'').length < 32) errors.push('ABDM_MASTER_ENCRYPTION_KEY must contain at least 32 characters');
if (config.publicBaseUrl && !/^https:\/\//.test(config.publicBaseUrl)) errors.push('ABDM_PUBLIC_BASE_URL must use HTTPS');
if (/\/api\/v3\/?$/.test(config.publicBaseUrl)) errors.push('ABDM_PUBLIC_BASE_URL must be the origin/base domain, not end with /api/v3');
if (!config.verifyCallbackJwt && config.callbackAllowedIps.length===0) warnings.push('Callback JWT verification and IP allow-list are both disabled');
if (!config.callbackExpectedIssuer) warnings.push('ABDM_CALLBACK_EXPECTED_ISSUER is not configured');
if (!config.callbackExpectedAudience) warnings.push('ABDM_CALLBACK_EXPECTED_AUDIENCE is not configured; confirm the sandbox token contract before setting it');

const sharedServices = [
  ['FHIR validator', config.sharedFhirValidatorUrl, config.sharedFhirValidatorAllowedHosts, config.sharedFhirValidatorToken],
  ['crypto adapter', config.sharedCryptoAdapterUrl, config.sharedCryptoAdapterAllowedHosts, config.sharedCryptoAdapterToken],
  ['consent validator', config.sharedConsentValidatorUrl, config.sharedConsentValidatorAllowedHosts, config.sharedConsentValidatorToken]
];
for (const [label, url, hosts, token] of sharedServices) {
  if (!url) { warnings.push(`Shared ${label} is not configured`); continue; }
  if (config.isProduction && (!hosts || hosts.length === 0)) errors.push(`Shared ${label} requires an explicit host allow-list in production`);
  if (config.isProduction && !token) errors.push(`Shared ${label} requires a private service token in production`);
  if (config.isProduction && token && token.length < 32) errors.push(`Shared ${label} private service token must contain at least 32 characters in production`);
  if (config.sharedServicesRequireHttps && !/^https:\/\//i.test(url)) errors.push(`Shared ${label} URL must use HTTPS when ABDM_SHARED_SERVICES_REQUIRE_HTTPS=true`);
}

if (config.isProduction) {
  const keySecret = String(process.env.ABDM_CRYPTO_KEY_HANDLE_SECRET_BASE64 || '');
  let keyBytes = 0;
  try { keyBytes = Buffer.from(keySecret, 'base64').length; } catch (_error) { keyBytes = 0; }
  if (keyBytes !== 32) errors.push('ABDM_CRYPTO_KEY_HANDLE_SECRET_BASE64 must decode to exactly 32 bytes in production');

  if (!process.env.ABDM_CONSENT_VALIDATOR_MONGO_URI) errors.push('ABDM_CONSENT_VALIDATOR_MONGO_URI is required for the shared consent service');
  if (String(process.env.ABDM_CONSENT_VALIDATOR_IDENTIFIER_PEPPER || '').length < 16) errors.push('ABDM_CONSENT_VALIDATOR_IDENTIFIER_PEPPER must contain at least 16 characters');
  if (!process.env.ABDM_CONSENT_VALIDATOR_EXPECTED_ISSUERS) errors.push('ABDM_CONSENT_VALIDATOR_EXPECTED_ISSUERS is required');
  if (!process.env.ABDM_CONSENT_VALIDATOR_EXPECTED_AUDIENCES) errors.push('ABDM_CONSENT_VALIDATOR_EXPECTED_AUDIENCES is required');
  const pinned = String(process.env.ABDM_CONSENT_VALIDATOR_PINNED_JWKS_JSON || '').trim();
  const remote = String(process.env.ABDM_CONSENT_VALIDATOR_JWKS_URL || '').trim();
  if (!pinned && !remote) errors.push('Configure ABDM_CONSENT_VALIDATOR_PINNED_JWKS_JSON or ABDM_CONSENT_VALIDATOR_JWKS_URL');
  if (remote && !process.env.ABDM_CONSENT_VALIDATOR_JWKS_ALLOWED_HOSTS) errors.push('ABDM_CONSENT_VALIDATOR_JWKS_ALLOWED_HOSTS is required when remote JWKS is enabled');
}
console.log(JSON.stringify({ valid:errors.length===0, role:config.appRole, environment:config.environment, features:{m1:config.featureM1,m2:config.featureM2,m3:config.featureM3,subscriptions:config.featureSubscriptions}, errors,warnings },null,2));
if (errors.length) process.exit(1);
