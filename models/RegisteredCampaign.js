const mongoose = require('mongoose');
const { Schema } = mongoose;

const RegisteredCampaignSchema = new Schema({
  userId: {
    type: String,
    ref: 'User',
    required: true,
    unique: true, // One document per user
  },
  registeredCampaignIds: [
    {
      type: Schema.Types.ObjectId,
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('RegisteredCampaign', RegisteredCampaignSchema);
