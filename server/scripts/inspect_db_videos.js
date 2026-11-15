require('dotenv').config();
const mongoose = require('mongoose');
const Video = require('../models/Video');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');
  const count = await Video.countDocuments();
  console.log('Video count in DB:', count);
  const sample = await Video.find({}).limit(10).lean();
  sample.forEach(v => {
    console.log(`[${v.id}] title: "${v.title}" | duration: "${v.duration}" | videoUrl: "${v.videoUrl}" | fallbackUrl: "${v.fallbackUrl}"`);
  });
  await mongoose.disconnect();
}
main().catch(console.error);

