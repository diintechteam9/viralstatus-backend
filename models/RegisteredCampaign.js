const mongoose = require('mongoose');
const { Schema } = mongoose;

const RegisteredCampaignSchema = new Schema({
  userId: {
    type: String,
    ref: 'User',
    required: true,
    unique: true, // One document per user
  },
  registeredCampaigns: [
    {
      type: Schema.Types.Mixed, // Store full campaign object
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('RegisteredCampaign', RegisteredCampaignSchema);
