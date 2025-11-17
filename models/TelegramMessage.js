const mongoose = require('mongoose');

const TelegramMessageSchema = new mongoose.Schema(
  {
    messageId: { 
      type: Number, 
      required: true, 
      unique: true,
      index: true 
    },
    chatId: { 
      type: String, 
      required: true, 
      index: true 
    },
    chatType: { 
      type: String, 
      enum: ['private', 'group', 'supergroup', 'channel'],
      required: true 
    },
    chatTitle: { 
      type: String 
    },
    fromUserId: { 
      type: Number, 
      index: true 
    },
    fromUsername: { 
      type: String 
    },
    fromFirstName: { 
      type: String 
    },
    fromLastName: { 
      type: String 
    },
    messageType: { 
      type: String, 
      enum: [
        'text', 
        'photo', 
        'video', 
        'audio', 
        'voice', 
        'document', 
        'sticker', 
        'location', 
        'contact', 
        'animation',
        'video_note',
        'poll',
        'new_chat_members',
        'left_chat_member',
        'new_chat_title',
        'new_chat_photo',
        'delete_chat_photo',
        'group_chat_created',
        'pinned_message',
        'other'
      ],
      default: 'text'
    },
    text: { 
      type: String 
    },
    caption: { 
      type: String 
    },
    photo: [{
      fileId: String,
      fileUniqueId: String,
      width: Number,
      height: Number,
      fileSize: Number
    }],
    video: {
      fileId: String,
      fileUniqueId: String,
      width: Number,
      height: Number,
      duration: Number,
      thumbnail: {
        fileId: String,
        fileUniqueId: String,
        width: Number,
        height: Number,
        fileSize: Number
      },
      fileName: String,
      mimeType: String,
      fileSize: Number
    },
    audio: {
      fileId: String,
      fileUniqueId: String,
      duration: Number,
      performer: String,
      title: String,
      fileName: String,
      mimeType: String,
      fileSize: Number
    },
    voice: {
      fileId: String,
      fileUniqueId: String,
      duration: Number,
      mimeType: String,
      fileSize: Number
    },
    document: {
      fileId: String,
      fileUniqueId: String,
      fileName: String,
      mimeType: String,
      fileSize: Number
    },
    location: {
      latitude: Number,
      longitude: Number,
      horizontalAccuracy: Number,
      livePeriod: Number,
      heading: Number,
      proximityAlertRadius: Number
    },
    contact: {
      phoneNumber: String,
      firstName: String,
      lastName: String,
      userId: Number,
      vcard: String
    },
    replyToMessageId: { 
      type: Number 
    },
    forwardFromChatId: { 
      type: String 
    },
    forwardFromMessageId: { 
      type: Number 
    },
    date: { 
      type: Date, 
      required: true,
      index: true 
    },
    editDate: { 
      type: Date 
    },
    rawUpdate: { 
      type: mongoose.Schema.Types.Mixed 
    }
  },
  { 
    timestamps: true 
  }
);

// Index for efficient querying
TelegramMessageSchema.index({ chatId: 1, date: -1 });
TelegramMessageSchema.index({ fromUserId: 1, date: -1 });
TelegramMessageSchema.index({ messageType: 1, date: -1 });

module.exports = mongoose.model('TelegramMessage', TelegramMessageSchema);