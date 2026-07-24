const mongoose = require('mongoose');

async function connectDB() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  mongoose.set('strictQuery', true);
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  return mongoose.connection;
}

module.exports = connectDB;
