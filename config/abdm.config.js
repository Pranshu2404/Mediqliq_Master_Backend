const ROLE = 'ABDM_MASTER';

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function csvEnv(name) {
  return String(process.env[name] || '').split(',').map((item) => item.trim()).filter(Boolean);
}

const environment = String(process.env.ABDM_ENV || 'sandbox').toLowerCase();
const isProduction = environment === 'production';
const defaultHiecmBaseUrl = isProduction
  ? 'https://apis.abdm.gov.in/api/hiecm'
  : 'https://dev.abdm.gov.in/api/hiecm';
const config = {
  appRole: ROLE, environment, isProduction, isMaster: true, isHospital: false,
  cmId: process.env.ABDM_CM_ID || (isProduction ? 'abdm' : 'sbx'),
  clientId: process.env.ABDM_CLIENT_ID,
  clientSecret: process.env.ABDM_CLIENT_SECRET,
  bridgeId: process.env.ABDM_BRIDGE_ID || process.env.ABDM_CLIENT_ID,
  sessionUrl: process.env.ABDM_SESSION_URL || (isProduction
    ? 'https://apis.abdm.gov.in/api/hiecm/gateway/v3/sessions'
    : 'https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions'),
  abhaBaseUrl: stripTrailingSlash(process.env.ABDM_ABHA_BASE_URL || (isProduction
    ? 'https://abha.abdm.gov.in/api/abha'
    : 'https://abhasbx.abdm.gov.in/abha/api')),
  hiecmBaseUrl: stripTrailingSlash(
    process.env.ABDM_HIECM_BASE_URL || defaultHiecmBaseUrl
  ),
  publicBaseUrl: stripTrailingSlash(process.env.ABDM_PUBLIC_BASE_URL || ''),
  openidConfigurationUrl:
    process.env.ABDM_OPENID_CONFIGURATION_URL ||
    `${stripTrailingSlash(
      process.env.ABDM_HIECM_BASE_URL || defaultHiecmBaseUrl
    )}/gateway/v3/.well-known/openid-configuration`,
  masterAdminKey: process.env.ABDM_MASTER_ADMIN_KEY,
  masterEncryptionKey: process.env.ABDM_MASTER_ENCRYPTION_KEY,
  storeCallbackPayloads: boolEnv('ABDM_STORE_CALLBACK_PAYLOADS', false),
  callbackTimeoutMs: Number(process.env.ABDM_CONNECTOR_TIMEOUT_MS || 15000),
  internalRequestMaxAgeMs: Number(process.env.ABDM_INTERNAL_REQUEST_MAX_AGE_MS || 300000),
  internalReplayTtlSeconds: Number(process.env.ABDM_INTERNAL_REPLAY_TTL_SECONDS || 600),
  verifyCallbackJwt: boolEnv('ABDM_VERIFY_CALLBACK_JWT', isProduction),
  callbackExpectedIssuer: process.env.ABDM_CALLBACK_EXPECTED_ISSUER || undefined,
  callbackExpectedAudience: process.env.ABDM_CALLBACK_EXPECTED_AUDIENCE || undefined,
  callbackRequiredClaims: csvEnv('ABDM_CALLBACK_REQUIRED_CLAIMS'),
  callbackAllowedIps: csvEnv('ABDM_CALLBACK_ALLOWED_IPS'),
  dataPushAllowedHosts: csvEnv('ABDM_DATA_PUSH_ALLOWED_HOSTS'),
  cryptoAdapterAllowedHosts: csvEnv('ABDM_CRYPTO_ADAPTER_ALLOWED_HOSTS'),
  connectorAllowedHosts: csvEnv('ABDM_CONNECTOR_ALLOWED_HOSTS'),
  featureM1: boolEnv('ABDM_ENABLE_M1', true),
  featureM2: boolEnv('ABDM_ENABLE_M2', true),
  featureM3: boolEnv('ABDM_ENABLE_M3', true),
  featureSubscriptions: boolEnv('ABDM_ENABLE_SUBSCRIPTIONS', false),
  fhirProfileBase: process.env.ABDM_FHIR_PROFILE_BASE || 'https://nrces.in/ndhm/fhir/r4/StructureDefinition'
};

function assertMasterCredentials() {
  if (!config.clientId || !config.clientSecret) throw new Error('ABDM_CLIENT_ID and ABDM_CLIENT_SECRET are required');
  if (!config.bridgeId) throw new Error('ABDM_BRIDGE_ID is required');
}

function assertSecureCallbackConfiguration() {
  if (config.isProduction && !config.verifyCallbackJwt && config.callbackAllowedIps.length === 0) {
    throw new Error('Production callbacks require JWT verification or an IP allow-list');
  }
}

module.exports = { ...config, assertMasterCredentials, assertSecureCallbackConfiguration, stripTrailingSlash, boolEnv, csvEnv };
