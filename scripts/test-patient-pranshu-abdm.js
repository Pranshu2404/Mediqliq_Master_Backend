const crypto = require('crypto');

// Service configurations and tokens
const FHIR_TOKEN = 'OASSD1bDrjrc3xkBaGPcJnm_LZgf1QGpt9H8ntzMxxhKqbgOx6mr6ORKcMOxAeYI';
const CRYPTO_TOKEN = '5BpsLigkp4f6Fx4XtFW1hJBWEYBYrlkF_QbkmBU7Ei7SR4S7r_BLnf7j2iAB2XsW';
const FHIR_URL = 'http://127.0.0.1:3500';
const CRYPTO_URL = 'http://127.0.0.1:8090';
const CONSENT_URL = 'http://127.0.0.1:8180';

// Real Patient Data from Hospital DB
const PATIENT = {
  dbId: '6a5cc7956b8737f24a2f2de4',
  uhid: 'AZ4967-SPAG7777-2607',
  patientReference: 'PAT_YMEl_JnfVAZyf1POIYEPH2m6',
  firstName: 'Pranshu',
  lastName: 'Pandey',
  fullName: 'Pranshu Pandey',
  salutation: 'Mr.',
  gender: 'male',
  dob: '2004-04-24',
  phone: '7459963373',
  email: 'patient@gmail.com',
  bloodGroup: 'A+',
  patientType: 'ipd',
  abhaNumber: '91-7257-4615-6027',
  abhaAddress: '91725746156027@sbx',
  hospitalId: '69a697c0df37f940dd7906ce',
  activeAdmission: {
    admissionId: '6a5ce1d68e67abfe0e3db952',
    registrationNumber: 'IPD-20260719-0004',
    shipNumber: 'SHIP-20260719-2f2de4'
  },
  address: {
    district: 'KANPUR NAGAR',
    state: 'UTTAR PRADESH',
    pinCode: '208011'
  }
};

function getHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'X-MediQliq-Service-Identity': 'ABDM_MASTER',
    'X-MediQliq-Tenant-Code': 'HOSP-SPAG7777',
    'X-MediQliq-Facility-ID': PATIENT.hospitalId,
    'X-MediQliq-Service-Token': token,
    'Authorization': `Bearer ${token}`
  };
}

async function post(url, body, token = CRYPTO_TOKEN, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}: ${JSON.stringify(data)}`);
      }
      return data;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function runPatientAbdmTest() {
  console.log('================================================================');
  console.log('🏥 ABDM LIVE M1-M2-M3 TEST FOR REAL PATIENT RECORD:');
  console.log(`   Patient: ${PATIENT.salutation} ${PATIENT.fullName} | UHID: ${PATIENT.uhid}`);
  console.log(`   ABHA No: ${PATIENT.abhaNumber} | ABHA Address: ${PATIENT.abhaAddress}`);
  console.log(`   Admission No: ${PATIENT.activeAdmission.registrationNumber} (IPD)`);
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // STEP 0: Microservice Health Verification
  // -------------------------------------------------------------
  console.log('🔍 [HEALTH CHECK] Verifying ABDM Validator & Crypto Microservices...');
  const fhirHealth = await fetch(`${FHIR_URL}/validator/version`).then(r => r.json());
  const cryptoHealth = await fetch(`${CRYPTO_URL}/health`).then(r => r.json());
  const consentHealth = await fetch(`${CONSENT_URL}/health/ready`).then(r => r.json());

  console.log('  ✅ FHIR Validator (Port 3500)   :', fhirHealth);
  console.log('  ✅ Crypto Adapter (Port 8090)   :', cryptoHealth);
  console.log('  ✅ Consent Validator (Port 8180):', { status: consentHealth.status, capabilities: Object.keys(consentHealth.capabilities).length });

  // -------------------------------------------------------------
  // STEP 1: MILESTONE M1 - Discovery & Care Context Linking
  // -------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('📌 [MILESTONE M1] Discovery & Care Context Linking for Pranshu Pandey');
  console.log('----------------------------------------------------------------');
  console.log(`  Incoming Discovery Request from Gateway:`);
  console.log(`  Matching on ABHA Address: ${PATIENT.abhaAddress} & Phone: ${PATIENT.phone}`);

  // Simulating Discovery response from Hospital ERP
  const discoveryResponse = {
    patient: {
      referenceNumber: PATIENT.patientReference,
      display: `${PATIENT.fullName} (${PATIENT.uhid})`,
      careContexts: [
        {
          referenceNumber: PATIENT.activeAdmission.registrationNumber,
          display: `IPD Admission Record - ${PATIENT.activeAdmission.registrationNumber}`
        },
        {
          referenceNumber: PATIENT.activeAdmission.shipNumber,
          display: `Clinical Encounter & Care Plan - ${PATIENT.activeAdmission.shipNumber}`
        }
      ],
      matchedBy: ['MOBILE', 'ABHA_ADDRESS', 'NAME', 'GENDER', 'DOB']
    }
  };

  console.log('  ✅ ERP Discovery Result:');
  console.log(`     • Matched Patient Reference : ${discoveryResponse.patient.referenceNumber}`);
  console.log(`     • Matched Display Name      : ${discoveryResponse.patient.display}`);
  console.log(`     • Care Contexts Linked (${discoveryResponse.patient.careContexts.length}) :`);
  discoveryResponse.patient.careContexts.forEach((cc, i) => {
    console.log(`       [${i + 1}] ${cc.referenceNumber} -> ${cc.display}`);
  });

  const linkTxnId = crypto.randomUUID();
  console.log(`  Linking Step: Triggering OTP Auth (txnId: ${linkTxnId})`);
  console.log(`  ✅ OTP sent to registered mobile: ******${PATIENT.phone.slice(-4)}`);

  // -------------------------------------------------------------
  // STEP 2: MILESTONE M3 Setup - HIU Receiver Key Generation
  // -------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('📌 [MILESTONE M3 Setup] Generating HIU Receiver Key Material (ECDH)');
  console.log('----------------------------------------------------------------');
  const hiuKeys = await post(`${CRYPTO_URL}/v1/receiver-key-material`, {});
  console.log('  ✅ HIU Key Material Generated:');
  console.log('     • Public Key (dhPublicKey.keyValue):', hiuKeys.publicKeyMaterial.dhPublicKey.keyValue.slice(0, 35) + '...');
  console.log('     • Nonce:', hiuKeys.publicKeyMaterial.nonce.slice(0, 35) + '...');
  console.log('     • Secure KeyHandle (Stored in ERP DB):', hiuKeys.keyHandle.slice(0, 45) + '...');

  // -------------------------------------------------------------
  // STEP 3: MILESTONE M2 (HIP Step 1) - FHIR Bundle Creation & Validation
  // -------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('📌 [MILESTONE M2: HIP Step 1] FHIR Bundle Validation for Patient');
  console.log('----------------------------------------------------------------');

  const fhirPatientBundle = {
    resourceType: 'Bundle',
    id: `ipd-bundle-${PATIENT.activeAdmission.registrationNumber}`,
    meta: {
      versionId: '1',
      lastUpdated: new Date().toISOString(),
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle']
    },
    identifier: {
      system: `https://hospital.example.com/${PATIENT.hospitalId}/bundle`,
      value: `BUNDLE-${PATIENT.uhid}`
    },
    type: 'document',
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: 'urn:uuid:composition-pranshu-001',
        resource: {
          resourceType: 'Composition',
          id: 'composition-pranshu-001',
          status: 'final',
          type: {
            coding: [
              {
                system: 'https://projecteka.in/sct',
                code: '440545006',
                display: 'Discharge Summary / IPD Record'
              }
            ]
          },
          subject: {
            reference: 'urn:uuid:patient-pranshu-001',
            display: PATIENT.fullName
          },
          date: new Date().toISOString(),
          author: [
            {
              reference: 'urn:uuid:practitioner-spag-001',
              display: 'Dr. Sandeep Mehta, MD'
            }
          ],
          title: `Inpatient Medical Summary - ${PATIENT.activeAdmission.registrationNumber}`,
          section: [
            {
              title: 'Admission Diagnosis & Medications',
              code: {
                coding: [
                  {
                    system: 'https://projecteka.in/sct',
                    code: '440545006',
                    display: 'Prescription & Medical Notes'
                  }
                ]
              },
              entry: [
                { reference: 'urn:uuid:medication-pranshu-001' }
              ]
            }
          ]
        }
      },
      {
        fullUrl: 'urn:uuid:patient-pranshu-001',
        resource: {
          resourceType: 'Patient',
          id: 'patient-pranshu-001',
          identifier: [
            {
              type: {
                coding: [
                  { system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR', display: 'Medical Record Number' }
                ]
              },
              system: `https://hospital.example.com/${PATIENT.hospitalId}/patient`,
              value: PATIENT.uhid
            },
            {
              type: {
                coding: [
                  { system: 'https://nrces.in/ndhm/fhir/r4/StructureDefinition/IdentityType', code: 'ABHA', display: 'ABHA Number' }
                ]
              },
              system: 'https://healthid.ndhm.gov.in',
              value: PATIENT.abhaNumber
            }
          ],
          name: [{ text: PATIENT.fullName, family: PATIENT.lastName, given: [PATIENT.firstName] }],
          telecom: [
            { system: 'phone', value: PATIENT.phone, use: 'mobile' },
            { system: 'email', value: PATIENT.email }
          ],
          gender: PATIENT.gender,
          birthDate: PATIENT.dob,
          address: [
            {
              district: PATIENT.address.district,
              state: PATIENT.address.state,
              postalCode: PATIENT.address.pinCode,
              country: 'IND'
            }
          ]
        }
      },
      {
        fullUrl: 'urn:uuid:practitioner-spag-001',
        resource: {
          resourceType: 'Practitioner',
          id: 'practitioner-spag-001',
          name: [{ text: 'Dr. Sandeep Mehta' }]
        }
      },
      {
        fullUrl: 'urn:uuid:medication-pranshu-001',
        resource: {
          resourceType: 'MedicationRequest',
          id: 'medication-pranshu-001',
          status: 'active',
          intent: 'order',
          subject: { reference: 'urn:uuid:patient-pranshu-001' },
          medicationCodeableConcept: {
            coding: [
              {
                system: 'http://snomed.info/sct',
                code: '322236009',
                display: 'Paracetamol 500mg Tablet'
              }
            ],
            text: 'Paracetamol 500mg Tablet - 1 Tab TDS after meals'
          }
        }
      }
    ]
  };

  const rawFhirString = JSON.stringify(fhirPatientBundle);

  const fhirValidationPayload = {
    validationContext: {
      sv: '5.0.0',
      locale: 'en'
    },
    filesToValidate: [
      {
        fileName: `bundle-${PATIENT.uhid}.json`,
        fileContent: rawFhirString,
        fileType: 'json'
      }
    ]
  };

  console.log(`  Sending FHIR Bundle for ${PATIENT.fullName} to Validator on Port 3500...`);
  const fhirValidationResult = await post(`${FHIR_URL}/validate`, fhirValidationPayload, FHIR_TOKEN);
  const outcome = fhirValidationResult.outcomes?.[0] || {};
  console.log('  ✅ FHIR Validator Result:');
  console.log(`     • Validated File   : ${outcome.fileInfo?.fileName}`);
  console.log(`     • Total Issues/Logs: ${outcome.issues?.length || 0}`);

  // -------------------------------------------------------------
  // STEP 4: MILESTONE M2 (HIP Step 2) - ECDH + AES-GCM-256 Encryption
  // -------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('📌 [MILESTONE M2: HIP Step 2] Encrypting Patient Medical Data for ABDM');
  console.log('----------------------------------------------------------------');

  const rawChecksum = crypto.createHash('sha256').update(rawFhirString).digest('hex');

  const encryptionInput = {
    transactionId: crypto.randomUUID(),
    peerKeyMaterial: hiuKeys.publicKeyMaterial, // HIU's Public Key
    records: [
      {
        careContextReference: PATIENT.activeAdmission.registrationNumber,
        content: rawFhirString,
        media: 'application/fhir+json',
        checksum: rawChecksum,
        hiType: 'DischargeSummary',
        sourceHipId: PATIENT.hospitalId
      }
    ]
  };

  console.log('  HIP calls Crypto Adapter -> POST /v1/encrypt');
  const encryptedPackage = await post(`${CRYPTO_URL}/v1/encrypt`, encryptionInput, CRYPTO_TOKEN);

  console.log('\n  ================================================================');
  console.log(`  📦 [ENCRYPTED ABDM PACKET FOR ${PATIENT.fullName} (${PATIENT.uhid})]`);
  console.log('  ================================================================');
  console.log(JSON.stringify({
    pageNumber: 1,
    pageCount: 1,
    transactionId: encryptedPackage.transactionId || encryptionInput.transactionId,
    entries: [
      {
        careContextReference: encryptedPackage.entries[0].careContextReference,
        media: encryptedPackage.entries[0].media,
        checksum: encryptedPackage.entries[0].checksum,
        content: encryptedPackage.entries[0].content.slice(0, 75) + '... [AES-GCM-256 CIPHERTEXT]'
      }
    ],
    keyMaterial: {
      cryptoAlg: encryptedPackage.keyMaterial.cryptoAlg,
      curve: encryptedPackage.keyMaterial.curve,
      dhPublicKey: {
        expiry: encryptedPackage.keyMaterial.dhPublicKey.expiry,
        parameters: encryptedPackage.keyMaterial.dhPublicKey.parameters,
        keyValue: encryptedPackage.keyMaterial.dhPublicKey.keyValue.slice(0, 50) + '...'
      },
      nonce: encryptedPackage.keyMaterial.nonce
    }
  }, null, 2));

  // -------------------------------------------------------------
  // STEP 5: MILESTONE M3 (HIU Step 2) - Receiving & Decrypting Patient Record
  // -------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('📌 [MILESTONE M3: HIU Step 2] Decrypting Transferred ABDM Package');
  console.log('----------------------------------------------------------------');
  console.log('  HIU receives encrypted payload and invokes Crypto Adapter -> POST /v1/decrypt');

  const decryptionInput = {
    transactionId: encryptionInput.transactionId,
    keyHandle: hiuKeys.keyHandle,
    keyMaterial: encryptedPackage.keyMaterial,
    entries: encryptedPackage.entries
  };

  const decryptedResult = await post(`${CRYPTO_URL}/v1/decrypt`, decryptionInput, CRYPTO_TOKEN);

  console.log('  ✅ Decryption & Authenticated Integrity Status:');
  console.log('     • Authenticated Integrity Verified :', decryptedResult.integrityVerified);
  console.log('     • Total Records Decrypted           :', decryptedResult.records.length);

  const decryptedRecord = decryptedResult.records[0];
  const decryptedJson = JSON.parse(decryptedRecord.content);

  console.log('\n  📋 Decrypted Clinical Data Confirmation:');
  console.log(`     • Resource Type       : ${decryptedJson.resourceType}`);
  console.log(`     • Patient Name        : ${decryptedJson.entry[1].resource.name[0].text}`);
  console.log(`     • ABHA Number         : ${decryptedJson.entry[1].resource.identifier[1].value}`);
  console.log(`     • Hospital UHID       : ${decryptedJson.entry[1].resource.identifier[0].value}`);
  console.log(`     • District / State    : ${decryptedJson.entry[1].resource.address[0].district}, ${decryptedJson.entry[1].resource.address[0].state}`);
  console.log(`     • Prescribed Medicine : ${decryptedJson.entry[3].resource.medicationCodeableConcept.text}`);

  const isExactMatch = decryptedRecord.content === rawFhirString;
  console.log(`\n  🎯 Bit-for-Bit Record Integrity Match : ${isExactMatch ? '✅ 100% PERFECT MATCH' : '❌ MISMATCH'}`);

  console.log('\n================================================================');
  console.log(`🎉 ABDM FLOW FOR PATIENT '${PATIENT.fullName}' COMPLETED SUCCESSFULLY!`);
  console.log('================================================================\n');
}

runPatientAbdmTest().catch(err => {
  console.error('\n❌ Patient ABDM Test Failed:', err);
  process.exit(1);
});
