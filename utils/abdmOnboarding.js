const ONBOARDING_STATES = [
  'NOT_CONFIGURED',
  'FACILITY_ID_RECEIVED',
  'FACILITY_VERIFICATION_PENDING',
  'FACILITY_VERIFIED',
  'SOFTWARE_LINKAGE_PENDING',
  'SOFTWARE_LINKED',
  'HIP_VERIFIED',
  'CONNECTOR_PENDING',
  'CONNECTOR_ACTIVE',
  'SCAN_SHARE_TESTING',
  'SCAN_SHARE_ACTIVE',
  'CARE_CONTEXT_TESTING',
  'CARE_CONTEXT_ACTIVE',
  'DATA_EXCHANGE_TESTING',
  'ABDM_LIVE',
  'SUSPENDED'
];

const TEST_STATUSES = ['NOT_TESTED', 'TESTING', 'PASSED', 'FAILED'];

function readiness(facility) {
  const config = require('../config/abdm.config');
  const hfrStatus = facility?.hfr?.status || facility?.hfrStatus;
  const linkageStatus = facility?.abdm?.linkageStatus || facility?.softwareLinkageStatus;
  const hipId = facility?.abdm?.hipId || facility?.facilityId;
  const connectorStatus = facility?.connector?.status;
  const scanStatus = facility?.rollout?.scanAndShare?.status;
  const careStatus = facility?.rollout?.careContext?.status;
  const dataStatus = facility?.rollout?.dataExchange?.status;

  const checks = {
    hfrVerified: hfrStatus === 'APPROVED',
    softwareLinked: linkageStatus === 'LINKED',
    hipVerified: Boolean(hipId) && linkageStatus === 'LINKED',
    connectorActive: connectorStatus === 'ACTIVE',
    scanAndSharePassed: scanStatus === 'PASSED',
    careContextPassed: careStatus === 'PASSED',
    dataExchangePassed: dataStatus === 'PASSED'
  };

  const dependencyReportedAt = facility?.dependencies?.reportedAt
    ? new Date(facility.dependencies.reportedAt).getTime()
    : 0;
  const dependencyReportFresh = Boolean(
    dependencyReportedAt &&
      Date.now() - dependencyReportedAt <= config.dependencyStatusTtlSeconds * 1000
  );
  const productionChecks = {
    dependencyReportFresh,
    productionTransferReady:
      dependencyReportFresh && facility?.dependencies?.productionTransferReady === true
  };
  const targetEnvironment = facility?.abdm?.environment || facility?.environment || config.environment;
  const requiredChecks = targetEnvironment === 'production'
    ? { ...checks, ...productionChecks }
    : checks;

  return {
    checks,
    productionChecks,
    dependencyReportedAt: dependencyReportedAt ? new Date(dependencyReportedAt) : null,
    dependencyStatusTtlSeconds: config.dependencyStatusTtlSeconds,
    readyForLive: Object.values(requiredChecks).every(Boolean),
    missing: Object.entries(requiredChecks)
      .filter(([, value]) => !value)
      .map(([key]) => key)
  };
}

module.exports = { ONBOARDING_STATES, TEST_STATUSES, readiness };
