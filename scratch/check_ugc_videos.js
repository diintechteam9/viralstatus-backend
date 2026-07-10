const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/viralstatus';

const UGCVideoSchema = new mongoose.Schema({}, { strict: false });
const UGCVideo = mongoose.model('UGCVideo', UGCVideoSchema, 'ugcvideos');

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const videos = await UGCVideo.find({});
  console.log(`Found ${videos.length} videos`);
  for (const v of videos) {
    console.log({
      _id: v._id,
      promptId: v.promptId,
      status: v.status,
      videoKey: v.videoKey,
      editedVideoKey: v.editedVideoKey,
      editedVideoUrl: v.editedVideoUrl,
      clientId: v.clientId,
      userId: v.userId
    });
  }

  await mongoose.disconnect();
}

main().catch(console.error);
