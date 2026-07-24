const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/abdm.config');
const { gatewayHeaders } = require('../utils/abdmRequest');

let cachedOpenId = null;
let cachedOpenIdUntil = 0;
let cachedJwks = null;
let cachedJwksUntil = 0;
const fetchFn = (...args) => typeof fetch === 'function' ? fetch(...args) : import('node-fetch').then(({ default: impl }) => impl(...args));

function absoluteUrl(value) {
  try { return new URL(value).toString(); }
  catch { return new URL(value, `${config.hiecmBaseUrl}/`).toString(); }
}

async function getOpenIdConfiguration() {
  if (cachedOpenId && Date.now() < cachedOpenIdUntil) return cachedOpenId;
  const response = await fetchFn(config.openidConfigurationUrl, { headers: gatewayHeaders(null), redirect: 'error' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.jwks_uri) throw new Error(`Unable to load ABDM OpenID configuration: ${response.status}`);
  cachedOpenId = data;
  cachedOpenIdUntil = Date.now() + 6 * 60 * 60 * 1000;
  return data;
}

async function getJwks(force = false) {
  if (!force && cachedJwks && Date.now() < cachedJwksUntil) return cachedJwks;
  const metadata = await getOpenIdConfiguration();
  const response = await fetchFn(absoluteUrl(metadata.jwks_uri), { headers: gatewayHeaders(null), redirect: 'error' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.keys)) throw new Error(`Unable to load ABDM callback signing keys: ${response.status}`);
  cachedJwks = data;
  cachedJwksUntil = Date.now() + 6 * 60 * 60 * 1000;
  return data;
}

function getBearer(value) {
  const match = String(value || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : String(value || '') || null;
}

async function verifyWithJwk(token, jwk) {
  const metadata = await getOpenIdConfiguration();
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const options = { algorithms: ['RS256', 'RS384', 'RS512'], clockTolerance: 60 };
  const issuer = config.callbackExpectedIssuer || metadata.issuer;
  if (issuer) options.issuer = issuer;
  if (config.callbackExpectedAudience) options.audience = config.callbackExpectedAudience;
  const claims = jwt.verify(token, publicKey, options);
  for (const claim of config.callbackRequiredClaims) {
    if (claims[claim] === undefined || claims[claim] === null) throw new Error(`ABDM callback JWT is missing required claim: ${claim}`);
  }
  return claims;
}

async function verifyCallbackToken(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header?.kid) throw new Error('ABDM callback JWT is missing kid');
  let jwks = await getJwks();
  let jwk = jwks.keys.find((key) => key.kid === decoded.header.kid);
  if (!jwk) { jwks = await getJwks(true); jwk = jwks.keys.find((key) => key.kid === decoded.header.kid); }
  if (!jwk) throw new Error('ABDM callback signing key not found');
  return verifyWithJwk(token, jwk);
}

module.exports = { verifyCallbackToken, getBearer, getJwks, getOpenIdConfiguration };
