require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const config = require('./config/abdm.config');
const app = require('./app');
const { startAbdmJobWorker, stopAbdmJobWorker } = require('./jobs/abdmJobWorker');
const { startPlatformDeliveryWorker, stopPlatformDeliveryWorker } = require('./jobs/platformDeliveryWorker');

async function start() {
  await connectDB();
  const port = Number(process.env.PORT || 5004);
  const server = http.createServer(app);
  server.listen(port, () => {
    console.log(`MediQliq ABDM Master listening on port ${port} (${config.environment})`);
  });
  startAbdmJobWorker();
  startPlatformDeliveryWorker();

  async function shutdown(signal) {
    console.log(`${signal} received; shutting down`);
    stopAbdmJobWorker();
    stopPlatformDeliveryWorker();
    server.close(async () => {
      await mongoose.connection.close(false);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
  console.error('Master startup failed:', error);
  process.exit(1);
});
