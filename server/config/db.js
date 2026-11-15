const mongoose = require('mongoose');
const dns = require('dns');

// On Windows, Node c-ares DNS often fails SRV lookups for mongodb+srv unless explicit servers are specified
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Graceful fallback if environment does not allow setting custom DNS
}

/**
 * Connects to MongoDB using Mongoose.
 * 
 * - Reads connection string from process.env.MONGODB_URI
 * - Throws a clear error if MONGODB_URI is missing
 * - Connects using mongoose.connect()
 * - Logs a clean success message (host only) without revealing credentials
 * - Catches and handles connection errors safely
 * 
 * @returns {Promise<typeof mongoose>}
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    const missingUriError = new Error('MONGODB_URI is not defined in environment variables');
    console.error('❌ Database Configuration Error: MONGODB_URI is missing in process.env');
    throw missingUriError;
  }

  try {
    const conn = await mongoose.connect(uri);
    console.log(`✅ MongoDB connected successfully: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`❌ MongoDB connection failed: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
