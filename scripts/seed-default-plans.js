require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Plan = require('../models/Plan');
const { DEFAULT_PLANS } = require('../utils/entitlements');

async function main() {
  await connectDB();
  for (const definition of DEFAULT_PLANS) {
    const result = await Plan.findOneAndUpdate(
      { code: definition.code },
      { $set: { ...definition, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true, runValidators: true }
    );
    console.log(`Seeded ${result.code} v${result.version}${result.internalOnly ? ' (internal)' : ''}`);
  }
}

main()
  .then(async () => { await mongoose.disconnect(); process.exit(0); })
  .catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => {}); process.exit(1); });
