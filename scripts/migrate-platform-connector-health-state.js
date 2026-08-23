require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Hospital = require('../models/Hospital');

async function run() {
  await connectDB();
  const result = await Hospital.updateMany(
    { 'platformConnector.status': 'UNREACHABLE' },
    {
      $set: {
        'platformConnector.status': 'PENDING',
        'platformConnector.healthStatus': 'UNREACHABLE'
      }
    }
  );
  console.log(`Platform connector health-state migration complete: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  await mongoose.connection.close(false);
}

run().catch(async (error) => {
  console.error('Platform connector health-state migration failed:', error);
  await mongoose.connection.close(false).catch(() => {});
  process.exit(1);
});
