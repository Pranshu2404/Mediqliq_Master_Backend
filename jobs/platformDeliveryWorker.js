const PlatformDelivery = require('../models/PlatformDelivery');
const License = require('../models/License');
const { forwardToHospital } = require('../services/platformConnector.service');

let timer;
let running = false;

function retryDelay(attempt) {
  return Math.min(60 * 60 * 1000, Math.max(5000, 5000 * (2 ** Math.min(attempt, 7))));
}

async function deliverOne(delivery) {
  delivery.attempts += 1;
  delivery.lastAttemptAt = new Date();
  try {
    await forwardToHospital(delivery.hospital, delivery.path, delivery.payload);
    delivery.status = 'DELIVERED';
    delivery.deliveredAt = new Date();
    delivery.lastError = undefined;
    await delivery.save();
    if (delivery.type === 'LICENSE_EVENT') {
      await License.updateOne(
        { hospital: delivery.hospital },
        { $set: { 'delivery.lastPushAt': new Date(), 'delivery.lastPushStatus': 'DELIVERED', 'delivery.lastPushError': null } }
      );
    }
  } catch (error) {
    delivery.status = delivery.attempts >= Number(process.env.PLATFORM_DELIVERY_MAX_ATTEMPTS || 12) ? 'FAILED' : 'PENDING';
    delivery.lastError = String(error.message || error).slice(0, 1000);
    delivery.nextRetryAt = new Date(Date.now() + retryDelay(delivery.attempts));
    await delivery.save();
    if (delivery.type === 'LICENSE_EVENT') {
      await License.updateOne(
        { hospital: delivery.hospital },
        { $set: { 'delivery.lastPushAt': new Date(), 'delivery.lastPushStatus': delivery.status, 'delivery.lastPushError': delivery.lastError } }
      );
    }
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const rows = await PlatformDelivery.find({ status: 'PENDING', nextRetryAt: { $lte: new Date() } })
      .sort({ nextRetryAt: 1 })
      .limit(Number(process.env.PLATFORM_DELIVERY_BATCH_SIZE || 20));
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      await deliverOne(row);
    }
  } catch (error) {
    console.error('Platform delivery worker failed:', error);
  } finally {
    running = false;
  }
}

function startPlatformDeliveryWorker() {
  if (timer) return;
  const interval = Number(process.env.PLATFORM_DELIVERY_POLL_MS || 10000);
  timer = setInterval(tick, interval);
  timer.unref?.();
  tick();
}

function stopPlatformDeliveryWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

module.exports = { startPlatformDeliveryWorker, stopPlatformDeliveryWorker, tick };
