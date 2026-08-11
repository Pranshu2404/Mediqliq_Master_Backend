# MediQliq Master ABDM FHIR Validator

This is the upstream HAPI FHIR validator wrapper with `ndhm.in#6.5.0` preloaded. It is deployed as a private service owned by the MediQliq Master backend.

Master configuration:

```env
ABDM_FHIR_VALIDATOR_URL=http://mediqliq-fhir-validator:3500/validate
ABDM_FHIR_VALIDATOR_HEALTH_URL=http://mediqliq-fhir-validator:3500/validator/version
ABDM_FHIR_VALIDATOR_ALLOWED_HOSTS=mediqliq-fhir-validator
ABDM_FHIR_VALIDATOR_TOKEN=<PRIVATE_SERVICE_TOKEN>
```

The `/validate` route requires the Master private-service token plus Master-injected tenant/facility headers. Health/version remains available only on the private service network. FHIR request content is not logged by the patched validation route. Do not expose this service through public ingress.
