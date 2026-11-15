const path = require('path');
const dotenv = require('dotenv');

// Load environment from server/.env
dotenv.config({ path: path.join(__dirname, 'server', '.env') });

// Change working directory to server so that server's node_modules are resolvable
if (!process.cwd().endsWith('server')) {
  process.chdir('server');
}

const mongoose = require('mongoose');

// Ensure test database is isolated from default database
const baseUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/';
let testUri = baseUri;
if (baseUri.includes('cluster0.vp7mrgp.mongodb.net/')) {
  testUri = baseUri.replace('cluster0.vp7mrgp.mongodb.net/', 'cluster0.vp7mrgp.mongodb.net/videoverse_test?retryWrites=true&w=majority');
} else if (!baseUri.includes('videoverse_test')) {
  testUri = baseUri.replace(/\/?$/, '/videoverse_test');
}
process.env.MONGODB_URI = testUri;

beforeAll(async () => {
  // Connect once for the entire test run
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
    });
  }
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

