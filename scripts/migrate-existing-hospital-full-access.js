/**
 * Master/Atlas migration for the pre-existing Test Hospital + unmapped legacy license.
 *
 * Defaults are intentionally the IDs supplied for the existing deployment. Override with env vars when needed:
 *   MIGRATION_HOSPITAL_ID=69a697c0df37f940dd7906ce
 *   MIGRATION_LICENSE_ID=69e5ea929de2a7177ab5fa51
 *   MIGRATION_FRONTEND_URL=https://hospital.example.com
 *   MIGRATION_BACKEND_URL=https://api-hospital.example.com
 *   MIGRATION_DATABASE_NAME=mediqliq_test_hospital
 *   MIGRATION_DRY_RUN=true
 *
 * This script NEVER accepts or stores a hospital MONGO_URI.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Hospital = require('../models/Hospital');
const License = require('../models/License');
const Plan = require('../models/Plan');
const User = require('../models/User');
const { DEFAULT_PLANS, FULL_ACCESS_ENTITLEMENTS } = require('../utils/entitlements');

const HOSPITAL_ID = process.env.MIGRATION_HOSPITAL_ID || '69a697c0df37f940dd7906ce';
const LICENSE_ID = process.env.MIGRATION_LICENSE_ID || '69e5ea929de2a7177ab5fa51';
const DRY_RUN = String(process.env.MIGRATION_DRY_RUN || '').toLowerCase() === 'true';

async function seedPlans() {
  for (const definition of DEFAULT_PLANS) {
    // eslint-disable-next-line no-await-in-loop
    await Plan.findOneAndUpdate({ code: definition.code }, { $set: definition }, { upsert: true, new: true, runValidators: true });
  }
  return Plan.findOne({ code: 'FULL_ACCESS' });
}

async function findHospital() {
  if (mongoose.Types.ObjectId.isValid(HOSPITAL_ID)) {
    const byId = await Hospital.findById(HOSPITAL_ID);
    if (byId) return byId;
  }
  return Hospital.findOne({
    $or: [
      { hospitalID: String(process.env.MIGRATION_HOSPITAL_CODE || 'AZ4967').toUpperCase() },
      { registryNo: process.env.MIGRATION_REGISTRY_NO || 'REG-2525' },
      { email: String(process.env.MIGRATION_HOSPITAL_EMAIL || 'admin@gmail.com').toLowerCase() }
    ]
  });
}

async function findLicense() {
  if (mongoose.Types.ObjectId.isValid(LICENSE_ID)) {
    const byId = await License.findById(LICENSE_ID);
    if (byId) return byId;
  }
  return License.findOne({ key: process.env.MIGRATION_LICENSE_KEY || 'HOSP-LAQD-93ZG-OSS8' });
}

async function main() {
  await connectDB();
  const hospital = await findHospital();
  if (!hospital) throw new Error(`Existing hospital was not found in Master DB (id/code/registry/email lookup failed)`);
  const license = await findLicense();
  if (!license) throw new Error(`Existing license was not found in Master DB (id/key lookup failed)`);

  const existingFullPlan = await Plan.findOne({ code: 'FULL_ACCESS' });
  const fullPlanDefinition = DEFAULT_PLANS.find((plan) => plan.code === 'FULL_ACCESS');
  const existingAdmin = hospital.primaryAdmin ? await User.findById(hospital.primaryAdmin).select('name email phone') : null;
  const tenantCode = String(hospital.tenantCode || hospital.hospitalID || process.env.MIGRATION_HOSPITAL_CODE || 'AZ4967').trim().toUpperCase();
  const deployment = {
    ...(hospital.deployment?.toObject?.() || hospital.deployment || {}),
    frontendUrl: process.env.MIGRATION_FRONTEND_URL ?? hospital.deployment?.frontendUrl ?? '',
    backendUrl: process.env.MIGRATION_BACKEND_URL ?? hospital.deployment?.backendUrl ?? '',
    databaseName: process.env.MIGRATION_DATABASE_NAME ?? hospital.deployment?.databaseName ?? '',
    environment: hospital.deployment?.environment || 'production',
    // Migration only maps control-plane metadata. Remote HIMS provisioning/sync is a separate explicit step.
    status: hospital.deployment?.status === 'SUSPENDED' ? 'SUSPENDED' : 'PLANNED'
  };

  console.log('Migration target:', {
    hospitalId: String(hospital._id),
    hospitalID: hospital.hospitalID,
    tenantCode,
    licenseId: String(license._id),
    licenseKey: license.key,
    legacyPlan: license.plan,
    newPlan: 'FULL_ACCESS',
    fullAccessPlanAlreadyExists: Boolean(existingFullPlan),
    frontendUrl: deployment.frontendUrl,
    backendUrl: deployment.backendUrl,
    databaseName: deployment.databaseName,
    dryRun: DRY_RUN
  });

  if (DRY_RUN) {
    console.log('DRY RUN: no plans, hospital records, or license records were modified.');
    console.log('Would map the supplied/existing license to this hospital and enable every FULL_ACCESS entitlement.');
    return;
  }

  const fullPlan = existingFullPlan || await seedPlans();
  if (!fullPlan) throw new Error('FULL_ACCESS plan could not be seeded');

  const hospitalChanges = {
    tenantCode,
    deployment,
    primaryAdminContact: {
      name: hospital.primaryAdminContact?.name || existingAdmin?.name || hospital.name || 'Hospital Administrator',
      email: hospital.primaryAdminContact?.email || existingAdmin?.email || hospital.email || 'admin@gmail.com',
      phone: hospital.primaryAdminContact?.phone || existingAdmin?.phone || hospital.contact || ''
    }
  };

  const startsAt = license.startsAt || license.createdAt || new Date('2026-04-20T08:57:54.930Z');
  const expiresAt = license.expiresAt || license.expiryDate || new Date('2027-04-20T08:57:54.922Z');
  const licenseChanges = {
    hospital: hospital._id,
    planId: fullPlan._id,
    planCode: 'FULL_ACCESS',
    planVersion: Number(fullPlan.version || fullPlanDefinition?.version || 1),
    plan: 'FULL_ACCESS',
    status: license.status || 'active',
    startsAt,
    expiresAt,
    expiryDate: expiresAt,
    entitlementSnapshot: { ...FULL_ACCESS_ENTITLEMENTS },
    entitlementOverrides: {},
    features: { ...FULL_ACCESS_ENTITLEMENTS },
    limitsSnapshot: fullPlan.limits || fullPlanDefinition?.limits || { patientMediaGb: 100, aiCallsMonthly: null },
    version: Math.max(Number(license.version || 0), 1),
    issuedTo: license.issuedTo || hospital.hospitalName,
    metadata: { ...(license.metadata || {}), migratedToSaasControlPlaneAt: new Date(), migration: 'full-access-v1' }
  };

  await Hospital.updateOne({ _id: hospital._id }, { $set: hospitalChanges });
  await License.updateOne({ _id: license._id }, { $set: licenseChanges });

  const verifiedHospital = await Hospital.findById(hospital._id).lean();
  const verifiedLicense = await License.findById(license._id).lean();
  if (String(verifiedLicense.hospital) !== String(verifiedHospital._id)) throw new Error('Verification failed: license is not mapped to hospital');
  if (verifiedLicense.planCode !== 'FULL_ACCESS') throw new Error('Verification failed: FULL_ACCESS plan missing');
  const denied = Object.entries(FULL_ACCESS_ENTITLEMENTS).filter(([key, value]) => value && verifiedLicense.entitlementSnapshot?.[key] !== true);
  if (denied.length) throw new Error(`Verification failed: missing full entitlements: ${denied.map(([key]) => key).join(', ')}`);

  console.log('SUCCESS: Master hospital + legacy license migrated. License is now mapped and has all entitlements.');
  console.log('IMPORTANT: configure platform connector and optional URLs in Master, then provision/sync HIMS. No MONGO_URI was stored in Master.');
}

main().then(async () => { await mongoose.disconnect(); process.exit(0); }).catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => {}); process.exit(1); });
