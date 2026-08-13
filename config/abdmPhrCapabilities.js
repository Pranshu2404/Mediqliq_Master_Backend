const PHR_APP_ABHA_OPERATIONS = Object.freeze([
  'GET /v3/phr/app/login/public/certificate',
  'POST /v3/phr/app/enrollment/request/otp',
  'POST /v3/phr/app/enrollment/verify',
  'POST /v3/phr/app/enrollment/suggestion',
  'GET /v3/phr/app/enrollment/isExists',
  'POST /v3/phr/app/enrollment/enrol',
  'POST /v3/phr/app/login/request/otp',
  'POST /v3/phr/app/login/verify',
  'POST /v3/phr/app/login/search',
  'POST /v3/phr/app/login/verify/user',
  'POST /v3/phr/app/login/profile/request/otp',
  'POST /v3/phr/app/login/profile/verify',
  'POST /v3/phr/app/login/profile/link',
  'POST /v3/phr/app/login/profile/deLink',
  'GET /v3/phr/app/login/profile/switch-profile',
  'POST /v3/phr/app/login/profile/verify/switch-profile/user',
  'GET /v3/phr/app/login/profile',
  'GET /v3/phr/app/login/profile/qrCode',
  'GET /v3/phr/app/login/profile/phrCard',
  'POST /v3/phr/app/login/profile/updateProfile',
  'GET /v3/phr/app/login/profile/request/token',
  'GET /v3/phr/app/login/profile/request/logout'
]);

const FACE_AUTH_ABHA_OPERATIONS = Object.freeze([
  'POST /v3/enrollment/enrol/auth/init',
  'POST /v3/enrollment/enrol/capturePID',
  'POST /v3/enrollment/enrol/byAadhaar',
  'POST /v3/profile/account/abha/search',
  'POST /v3/profile/login/request/otp',
  'POST /v3/profile/login/verify',
  'POST /v3/profile/login/verify/user'
]);

const PHR_HIU_ACTIONS = Object.freeze([
  'INIT_CONSENT_REQUEST',
  'GET_CONSENT_STATUS',
  'FETCH_CONSENT',
  'LIST_CONSENT_REQUESTS',
  'GET_CONSENT_REQUEST',
  'GET_CONSENT_ARTEFACTS_BY_REQUEST',
  'GET_CONSENT_ARTEFACT',
  'LIST_CONSENT_ARTEFACTS',
  'CREATE_CONSENT_AUTO_APPROVE',
  'DISABLE_CONSENT_AUTO_APPROVE',
  'ENABLE_CONSENT_AUTO_APPROVE',
  'DENY_CONSENT_REQUEST',
  'REVOKE_CONSENT',
  'REQUEST_HEALTH_INFORMATION',
  'GET_HEALTH_INFORMATION_STATUS',
  'NOTIFY_HEALTH_INFORMATION',
  'PHR_DISCOVER_HEALTH_RECORDS',
  'PHR_LINK_CARE_CONTEXT_INIT',
  'PHR_LINK_CARE_CONTEXT_CONFIRM',
  'PHR_LIST_LINKS',
  'PHR_LIST_PROVIDERS',
  'PHR_GET_PROVIDER',
  'PHR_GOVT_PROGRAMS',
  'LIST_HEALTH_LOCKERS',
  'INIT_SUBSCRIPTION',
  'APPROVE_SUBSCRIPTION',
  'DENY_SUBSCRIPTION',
  'LIST_SUBSCRIPTION_REQUESTS',
  'GET_SUBSCRIPTION_REQUEST',
  'GET_SUBSCRIPTION',
  'EDIT_SUBSCRIPTION',
  'DISABLE_SUBSCRIPTION',
  'ENABLE_SUBSCRIPTION',
  'PATIENT_SUBSCRIPTION_REQUESTS',
  'SETUP_HEALTH_LOCKER',
  'LIST_PATIENT_LOCKERS',
  'GET_PATIENT_LOCKER'
]);

const PHR_USER_INITIATED_CALLBACKS = Object.freeze([
  '/api/v3/hiu/patient/care-context/on-discover',
  '/api/v3/hiu/patient/care-context/on-init',
  '/api/v3/hiu/patient/care-context/on-confirm'
]);

module.exports = {
  PHR_APP_ABHA_OPERATIONS,
  FACE_AUTH_ABHA_OPERATIONS,
  PHR_HIU_ACTIONS,
  PHR_USER_INITIATED_CALLBACKS
};
