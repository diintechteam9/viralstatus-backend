const mongoose = require('mongoose');

const responseSchema = new mongoose.Schema({
    urls: { type: String, required: true },
    campaignId: { type: String, required: true },
    reelId: { type: String },
    isTaskCompleted: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    cutoff: { type: Number },
    isCreditAccepted: { type: Boolean, default: false },
    creditAmount: { type: Number, default: 0 },
    status: { type: String, default: 'pending' }
}, { timestamps: true });

const userResponseSchema = new mongoose.Schema({
    googleId: { type: String, required: true, index: true },
    response: [responseSchema]
});

module.exports = mongoose.model('userResponse',userResponseSchema);