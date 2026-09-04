const crypto = require('crypto');
const Hospital = require('../models/Hospital');
const License = require('../models/License');
const ElectronEnrollment = require('../models/ElectronEnrollment');
const { encryptSecret, decryptSecret } = require('../utils/secretVault');
const { buildLicensePayload } = require('../services/licenseControl.service');

// ============================================
// Helpers
// ============================================

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function publicCode() {
  return crypto.randomBytes(24).toString('base64url');
}

// ============================================
// Issue Enrollment Code
// ============================================

exports.issue = async (req, res) => {
  const hospital = await Hospital.findById(req.params.hospitalId)
    .select(
      '+platformConnector.secretEncrypted +platformConnector.secretEncrypted.ciphertext +platformConnector.secretEncrypted.iv +platformConnector.secretEncrypted.tag'
    );

  if (!hospital) {
    return res.status(404).json({
      success: false,
      message: 'Hospital not found'
    });
  }

  if (hospital.deployment?.type !== 'LOCAL_ELECTRON') {
    return res.status(409).json({
      success: false,
      message: 'Enrollment codes are only for LOCAL_ELECTRON hospitals'
    });
  }

  const password = String(req.body?.administratorPassword || '');

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'Temporary administrator password must be at least 8 characters'
    });
  }

  if (!hospital.platformConnector?.secretEncrypted || !hospital.platformConnector?.keyId) {
    const secret = crypto.randomBytes(48).toString('base64url');

    hospital.platformConnector.keyId = `platform-${hospital.tenantCode.toLowerCase()}-${crypto.randomBytes(4).toString('hex')}`;
    hospital.platformConnector.secretEncrypted = encryptSecret(secret);
  }

  hospital.platformConnector.status = 'PENDING';
  hospital.platformConnector.healthStatus = 'UNKNOWN';
  hospital.deployment.status = 'AWAITING_ENROLLMENT';

  await hospital.save();

  await ElectronEnrollment.updateMany(
    { hospital: hospital._id, status: 'ISSUED' },
    { $set: { status: 'REVOKED' } }
  );

  const token = publicCode();
  const expiresAt = new Date(
    Date.now() + Number(process.env.ELECTRON_ENROLLMENT_TTL_MINUTES || 60) * 60000
  );

  await ElectronEnrollment.create({
    hospital: hospital._id,
    tokenHash: tokenHash(token),
    temporaryPasswordEncrypted: encryptSecret(password),
    expiresAt,
    createdBy: req.user._id
  });

  res.status(201).json({
    success: true,
    enrollmentCode: token,
    expiresAt,
    tenantCode: hospital.tenantCode,
    hospitalID: hospital.hospitalID
  });
};

// ============================================
// Redeem Enrollment Code
// ============================================

exports.redeem = async (req, res) => {
  const code = String(req.body?.enrollmentCode || '').trim();
  const installationId = String(req.body?.installationId || '').trim();

  if (!code || !installationId) {
    return res.status(400).json({
      success: false,
      message: 'enrollmentCode and installationId are required'
    });
  }

  const enrollment = await ElectronEnrollment.findOne({
    tokenHash: tokenHash(code)
  })
    .select(
      '+temporaryPasswordEncrypted +temporaryPasswordEncrypted.ciphertext +temporaryPasswordEncrypted.iv +temporaryPasswordEncrypted.tag'
    )
    .populate({
      path: 'hospital',
      select:
        '+platformConnector.secretEncrypted +platformConnector.secretEncrypted.ciphertext +platformConnector.secretEncrypted.iv +platformConnector.secretEncrypted.tag'
    });

  if (!enrollment || !enrollment.hospital) {
    return res.status(404).json({
      success: false,
      message: 'Enrollment code is invalid'
    });
  }

  if (!['ISSUED', 'CLAIMED'].includes(enrollment.status)) {
    return res.status(409).json({
      success: false,
      message: `Enrollment code is ${enrollment.status.toLowerCase()}`
    });
  }

  if (enrollment.status === 'CLAIMED' && String(enrollment.installationId) !== installationId) {
    return res.status(409).json({
      success: false,
      message: 'Enrollment code is already claimed by another installation'
    });
  }

  if (enrollment.expiresAt.getTime() <= Date.now()) {
    enrollment.status = 'EXPIRED';
    await enrollment.save();

    return res.status(410).json({
      success: false,
      message: 'Enrollment code has expired'
    });
  }

  const hospital = enrollment.hospital;
  const license = await License.findOne({ hospital: hospital._id });

  if (!license) {
    return res.status(409).json({
      success: false,
      message: 'Hospital license is not configured'
    });
  }

  enrollment.status = 'CLAIMED';
  enrollment.claimedAt = enrollment.claimedAt || new Date();
  enrollment.installationId = installationId;
  await enrollment.save();

  hospital.deployment.status = 'PROVISIONING';
  hospital.deployment.lastProvisionAttemptAt = new Date();
  hospital.deployment.provisioningId = hospital.deployment.provisioningId || crypto.randomUUID();
  await hospital.save();

  res.json({
    success: true,
    enrollmentId: String(enrollment._id),
    provisioning: {
      provisioningId: hospital.deployment.provisioningId,
      version: Number(hospital.deployment.provisioningVersion || 1),
      hospital: {
        masterHospitalId: String(hospital._id),
        hospitalID: hospital.hospitalID,
        tenantCode: hospital.tenantCode,
        registryNo: hospital.registryNo,
        hospitalName: hospital.hospitalName,
        companyName: hospital.companyName,
        licenseNumber: hospital.licenseNumber,
        name: hospital.name,
        address: hospital.address,
        contact: hospital.contact,
        pinCode: hospital.pinCode,
        city: hospital.city,
        state: hospital.state,
        email: hospital.email,
        additionalInfo: hospital.additionalInfo,
        vitalsEnabled: hospital.vitalsEnabled,
        vitalsController: hospital.vitalsController,
        deployment: {
          type: 'LOCAL_ELECTRON',
          frontendUrl: '',
          backendUrl: '',
          databaseName: hospital.deployment.databaseName || '',
          environment: hospital.deployment.environment || 'production'
        },
        onboarding: hospital.onboarding || {}
      },
      administrator: {
        name: hospital.primaryAdminContact?.name,
        email: hospital.primaryAdminContact?.email,
        phone: hospital.primaryAdminContact?.phone,
        temporaryPassword: decryptSecret(enrollment.temporaryPasswordEncrypted)
      },
      license: buildLicensePayload(license),
      connector: {
        masterUrl: String(process.env.PUBLIC_MASTER_URL || process.env.PLATFORM_PUBLIC_URL || '')
          .replace(/\/+$/, ''),
        tenantCode: hospital.tenantCode,
        keyId: hospital.platformConnector.keyId,
        secret: decryptSecret(hospital.platformConnector.secretEncrypted)
      }
    }
  });
};

// ============================================
// Complete Enrollment
// ============================================

exports.complete = async (req, res) => {
  const enrollment = await ElectronEnrollment.findById(req.body?.enrollmentId)
    .populate('hospital');

  if (!enrollment || !enrollment.hospital) {
    return res.status(404).json({
      success: false,
      message: 'Enrollment not found'
    });
  }

  if (enrollment.status !== 'CLAIMED') {
    return res.status(409).json({
      success: false,
      message: `Enrollment is ${enrollment.status.toLowerCase()}`
    });
  }

  if (String(enrollment.installationId) !== String(req.body?.installationId || '')) {
    return res.status(401).json({
      success: false,
      message: 'Installation identity mismatch'
    });
  }

  enrollment.status = 'COMPLETED';
  enrollment.completedAt = new Date();
  enrollment.temporaryPasswordEncrypted = undefined;
  await enrollment.save({ validateBeforeSave: false });

  const hospital = enrollment.hospital;

  hospital.deployment.status = 'READY';
  hospital.deployment.provisionedAt = new Date();
  hospital.deployment.lastProvisionSuccessAt = new Date();
  hospital.deployment.lastProvisionError = undefined;
  hospital.deployment.lastProvisionErrorCode = undefined;
  hospital.platformConnector.status = 'ACTIVE';
  hospital.platformConnector.healthStatus = 'OK';
  hospital.onboarding.status = 'ADMIN_PROVISIONED';

  await hospital.save();

  res.json({
    success: true
  });
};