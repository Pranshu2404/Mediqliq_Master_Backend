# MediQliq Central ABDM Shared Services - Build Report

This patch centralizes the private FHIR Validator, Crypto Adapter, and Consent Validator under the MediQliq Master backend and migrates the hospital backend to consume them through its authenticated Master connector.

## Validation completed

- Master backend static shared-service/API tests: **12/12 passed**.
- Crypto Adapter facade tests: **2/2 passed**.
- Consent Validator policy/trust tests: **13/13 passed**.
- Hospital backend central-service migration/contract tests: **6/6 passed**.
- Changed/new JavaScript files in Master backend and Hospital backend: `node --check` passed.
- Changed/new MediQliq Master frontend JS/JSX files: TypeScript JSX transpilation passed with no syntax diagnostics.
- Repository search confirmed that the hospital runtime wrappers no longer use `ABDM_FHIR_VALIDATOR_URL`, `ABDM_CRYPTO_ADAPTER_URL`, or `ABDM_CONSENT_VALIDATOR_URL` directly.

## Environment limitation

The FHIR validator Gradle wrapper could not download its Gradle distribution from `services.gradle.org` in this execution environment, so a fresh JVM compilation was not completed here. No Kotlin compiler diagnostic was produced; deployment/CI should run the normal Gradle build with network/dependency access before release.

## Release checks still required in deployment/CI

1. Build the moved FHIR validator container/JVM application.
2. Build and start all three private Master-side service containers.
3. Configure Master-side private service tokens/secrets/trust settings.
4. Run a live hospital connector smoke test through `/internal/abdm/shared/*`.
5. Verify FHIR validation, Crypto receiver-key/encrypt/decrypt, and Consent validate/reservation commit/release for two different hospital connectors to confirm tenant isolation.
6. Verify Master Admin `/abdm/shared-services/health` reports all services healthy before enabling production M2/M3 transfer.
