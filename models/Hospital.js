const mongoose = require('mongoose');

function generateHospitalId() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  let result = '';
  for (let i = 0; i < 2; i += 1) result += letters.charAt(Math.floor(Math.random() * letters.length));
  for (let i = 0; i < 4; i += 1) result += numbers.charAt(Math.floor(Math.random() * numbers.length));
  return result;
}

async function generateUniqueHospitalId(HospitalModel) {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const hospitalId = generateHospitalId();
    // eslint-disable-next-line no-await-in-loop
    const existingHospital = await HospitalModel.exists({ hospitalID: hospitalId });
    if (!existingHospital) return hospitalId;
  }
  throw new Error('Unable to generate unique hospital ID after multiple attempts');
}

const encryptedSecretSchema = new mongoose.Schema({
  ciphertext: { type: String, select: false },
  iv: { type: String, select: false },
  tag: { type: String, select: false }
}, { _id: false });

const hospitalSchema = new mongoose.Schema(
  {
    hospitalID: { type: String, required: true, unique: true, trim: true, uppercase: true },
    tenantCode: { type: String, unique: true, sparse: true, trim: true, uppercase: true, index: true },
    registryNo: { type: String, required: true, trim: true },
    hospitalName: { type: String, required: true, trim: true },
    logo: String,
    companyName: String,
    licenseNumber: String,
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    contact: { type: String, required: true, trim: true },
    pinCode: String,
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    fireNOC: String,
    policyDetails: String,
    healthBima: String,
    additionalInfo: String,
    vitalsEnabled: { type: Boolean, default: true },
    vitalsController: {
      type: String,
      enum: ['doctor', 'nurse', 'registrar'],
      default: 'nurse'
    },

    tariffProfile: {
      cityTier: { type: String, enum: ['I', 'II', 'III'], default: 'I' },
      accreditation: { type: String, enum: ['non_nabh_non_nabl', 'nabh_nabl', 'super_speciality'], default: 'nabh_nabl' },
      superSpecialities: [String]
    },
    featureFlags: {
      radiologyDashboard: { type: Boolean, default: false },
      pathologyUnifiedWorklist: { type: Boolean, default: false },
      sponsorPricing: { type: Boolean, default: false },
      bedTransferWorkflow: { type: Boolean, default: false },
      workforceSelfService: { type: Boolean, default: false },
      biometricAttendance: { type: Boolean, default: false }
    },

    deployment: {
      // Vercel/static frontend URL is optional but stored centrally alongside the backend URL.
      frontendUrl: { type: String, trim: true },
      backendUrl: { type: String, trim: true },
      databaseName: { type: String, trim: true },
      environment: { type: String, enum: ['development', 'sandbox', 'production'], default: 'production' },
      status: {
        type: String,
        enum: ['PLANNED', 'PROVISIONING', 'READY', 'PROVISIONING_FAILED', 'SUSPENDED'],
        default: 'PLANNED',
        index: true
      },
      provisionedAt: Date,
      provisioningId: { type: String, index: true, sparse: true },
      provisioningVersion: { type: Number, default: 1 },
      lastProvisionAttemptAt: Date,
      lastProvisionSuccessAt: Date,
      lastProvisionError: String,
      remoteHospitalId: String,
      remoteAdminId: String
    },

    platformConnector: {
      keyId: { type: String, trim: true },
      secretEncrypted: { type: encryptedSecretSchema, select: false },
      status: {
        type: String,
        enum: ['NOT_CONFIGURED', 'PENDING', 'ACTIVE', 'DISABLED', 'UNREACHABLE'],
        default: 'NOT_CONFIGURED',
        index: true
      },
      lastHealthCheckAt: Date,
      lastHealthCheckStatus: String,
      lastHealthCheckError: String
    },

    onboarding: {
      status: {
        type: String,
        enum: ['CREATED', 'ADMIN_PROVISIONED', 'PROFILE_PENDING', 'OPERATIONAL_SETUP', 'READY'],
        default: 'CREATED'
      },
      abdmChoice: {
        type: String,
        enum: ['EXISTING_HFR', 'NEEDS_HFR_REGISTRATION', 'CONFIGURE_LATER'],
        default: 'CONFIGURE_LATER'
      },
      hfrFacilityId: String,
      facilityManagerName: String,
      facilityManagerEmail: String,
      facilityManagerMobile: String
    },

    abdmFacility: { type: mongoose.Schema.Types.ObjectId, ref: 'AbdmFacility', sparse: true },

    // Hospital administrators authenticate only against HIMS. Master stores contact/provisioning metadata.
    primaryAdminContact: {
      name: { type: String, trim: true },
      email: { type: String, lowercase: true, trim: true },
      phone: { type: String, trim: true }
    },

    // Deprecated compatibility reference. Do not create new hospital-admin Master users.
    primaryAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', sparse: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

hospitalSchema.pre('validate', async function assignIdentifiers(next) {
  try {
    if (this.isNew && !this.hospitalID) this.hospitalID = await generateUniqueHospitalId(this.constructor);
    if (!this.tenantCode && this.hospitalID) this.tenantCode = this.hospitalID;
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('Hospital', hospitalSchema);
