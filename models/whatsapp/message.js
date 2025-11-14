const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  waID: { type: String, required: true, index: true },
  direction: { type: String, enum: ['sent', 'received', 'system'], required: true },
  type: { type: String, enum: ['text', 'media', 'interactive'], default: 'text' },
  text: { type: String },
  mediaType: { type: String },
  mediaUrl: { type: String },
  messageId: { type: String },
  status: { type: String },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;


