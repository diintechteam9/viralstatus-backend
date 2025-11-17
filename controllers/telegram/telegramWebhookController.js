const { Telegraf } = require('telegraf');
const TelegramMessage = require('../../models/telegram/TelegramMessage');
require('dotenv').config();

class TelegramWebhookController {
  constructor() {
    this.bot = new Telegraf(process.env.TELEGRAMBOT_API_KEY);
    this.secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || null;
    this.setupMessageHandlers();
  }

  // Setup message handlers
  setupMessageHandlers() {
    // Handle all messages
    this.bot.on('message', async (ctx) => {
      try {
        await this.saveMessage(ctx);
      } catch (error) {
        console.error('Error saving message:', error);
      }
    });

    // Handle edited messages
    this.bot.on('edited_message', async (ctx) => {
      try {
        await this.saveEditedMessage(ctx);
      } catch (error) {
        console.error('Error saving edited message:', error);
      }
    });

    // Handle channel posts
    this.bot.on('channel_post', async (ctx) => {
      try {
        await this.saveMessage(ctx);
      } catch (error) {
        console.error('Error saving channel post:', error);
      }
    });
  }

  // Extract message data from context
  extractMessageData(ctx) {
    const message = ctx.message || ctx.channelPost || ctx.editedMessage;
    if (!message) return null;

    const chat = message.chat;
    const from = message.from;
    const date = new Date(message.date * 1000);

    const messageData = {
      messageId: message.message_id,
      chatId: String(chat.id),
      chatType: chat.type,
      chatTitle: chat.title || chat.username || null,
      date: date,
      rawUpdate: ctx.update
    };

    // Add sender information if available
    if (from) {
      messageData.fromUserId = from.id;
      messageData.fromUsername = from.username || null;
      messageData.fromFirstName = from.first_name || null;
      messageData.fromLastName = from.last_name || null;
    }

    // Handle reply to message
    if (message.reply_to_message) {
      messageData.replyToMessageId = message.reply_to_message.message_id;
    }

    // Handle forwarded messages
    if (message.forward_from_chat) {
      messageData.forwardFromChatId = String(message.forward_from_chat.id);
      messageData.forwardFromMessageId = message.forward_from_message_id;
    }

    // Determine message type and extract content
    if (message.text) {
      messageData.messageType = 'text';
      messageData.text = message.text;
    } else if (message.photo && message.photo.length > 0) {
      messageData.messageType = 'photo';
      messageData.photo = message.photo.map(photo => ({
        fileId: photo.file_id,
        fileUniqueId: photo.file_unique_id,
        width: photo.width,
        height: photo.height,
        fileSize: photo.file_size
      }));
      messageData.caption = message.caption || null;
    } else if (message.video) {
      messageData.messageType = 'video';
      messageData.video = {
        fileId: message.video.file_id,
        fileUniqueId: message.video.file_unique_id,
        width: message.video.width,
        height: message.video.height,
        duration: message.video.duration,
        fileName: message.video.file_name || null,
        mimeType: message.video.mime_type || null,
        fileSize: message.video.file_size || null
      };
      if (message.video.thumbnail) {
        messageData.video.thumbnail = {
          fileId: message.video.thumbnail.file_id,
          fileUniqueId: message.video.thumbnail.file_unique_id,
          width: message.video.thumbnail.width,
          height: message.video.thumbnail.height,
          fileSize: message.video.thumbnail.file_size
        };
      }
      messageData.caption = message.caption || null;
    } else if (message.audio) {
      messageData.messageType = 'audio';
      messageData.audio = {
        fileId: message.audio.file_id,
        fileUniqueId: message.audio.file_unique_id,
        duration: message.audio.duration,
        performer: message.audio.performer || null,
        title: message.audio.title || null,
        fileName: message.audio.file_name || null,
        mimeType: message.audio.mime_type || null,
        fileSize: message.audio.file_size || null
      };
    } else if (message.voice) {
      messageData.messageType = 'voice';
      messageData.voice = {
        fileId: message.voice.file_id,
        fileUniqueId: message.voice.file_unique_id,
        duration: message.voice.duration,
        mimeType: message.voice.mime_type || null,
        fileSize: message.voice.file_size || null
      };
    } else if (message.document) {
      messageData.messageType = 'document';
      messageData.document = {
        fileId: message.document.file_id,
        fileUniqueId: message.document.file_unique_id,
        fileName: message.document.file_name || null,
        mimeType: message.document.mime_type || null,
        fileSize: message.document.file_size || null
      };
      messageData.caption = message.caption || null;
    } else if (message.location) {
      messageData.messageType = 'location';
      messageData.location = {
        latitude: message.location.latitude,
        longitude: message.location.longitude,
        horizontalAccuracy: message.location.horizontal_accuracy || null,
        livePeriod: message.location.live_period || null,
        heading: message.location.heading || null,
        proximityAlertRadius: message.location.proximity_alert_radius || null
      };
    } else if (message.contact) {
      messageData.messageType = 'contact';
      messageData.contact = {
        phoneNumber: message.contact.phone_number,
        firstName: message.contact.first_name,
        lastName: message.contact.last_name || null,
        userId: message.contact.user_id || null,
        vcard: message.contact.vcard || null
      };
    } else if (message.sticker) {
      messageData.messageType = 'sticker';
    } else if (message.animation) {
      messageData.messageType = 'animation';
      messageData.caption = message.caption || null;
    } else if (message.video_note) {
      messageData.messageType = 'video_note';
    } else if (message.poll) {
      messageData.messageType = 'poll';
    } else if (message.new_chat_members) {
      messageData.messageType = 'new_chat_members';
    } else if (message.left_chat_member) {
      messageData.messageType = 'left_chat_member';
    } else if (message.new_chat_title) {
      messageData.messageType = 'new_chat_title';
      messageData.text = message.new_chat_title;
    } else if (message.new_chat_photo) {
      messageData.messageType = 'new_chat_photo';
    } else if (message.delete_chat_photo) {
      messageData.messageType = 'delete_chat_photo';
    } else if (message.group_chat_created) {
      messageData.messageType = 'group_chat_created';
    } else if (message.pinned_message) {
      messageData.messageType = 'pinned_message';
    } else {
      messageData.messageType = 'other';
    }

    return messageData;
  }

  // Save message to MongoDB
  async saveMessage(ctx) {
    try {
      const messageData = this.extractMessageData(ctx);
      if (!messageData) {
        console.log('No message data to save');
        return;
      }

      // Check if message already exists (avoid duplicates)
      const existingMessage = await TelegramMessage.findOne({ 
        messageId: messageData.messageId 
      });

      if (existingMessage) {
        console.log(`Message ${messageData.messageId} already exists, skipping...`);
        return;
      }

      // Save to MongoDB
      const savedMessage = await TelegramMessage.create(messageData);
      console.log(`Message saved: ${savedMessage.messageId} from chat ${savedMessage.chatId}`);
      
      return savedMessage;
    } catch (error) {
      console.error('Error saving message to database:', error);
      throw error;
    }
  }

  // Save edited message
  async saveEditedMessage(ctx) {
    try {
      const messageData = this.extractMessageData(ctx);
      if (!messageData) {
        return;
      }

      // Update existing message or create new entry
      const updatedMessage = await TelegramMessage.findOneAndUpdate(
        { messageId: messageData.messageId },
        {
          ...messageData,
          editDate: new Date()
        },
        { 
          upsert: true, 
          new: true 
        }
      );

      console.log(`Edited message saved: ${updatedMessage.messageId}`);
      return updatedMessage;
    } catch (error) {
      console.error('Error saving edited message:', error);
      throw error;
    }
  }

  // Get webhook callback for Express
  getWebhookCallback() {
    return this.bot.webhookCallback('/api/telegram/webhook');
  }

  // Handle webhook update manually
  async handleUpdate(update) {
    try {
      await this.bot.handleUpdate(update);
      return { success: true };
    } catch (error) {
      console.error('Error handling update:', error);
      return { success: false, error: error.message };
    }
  }

  // Verify secret token
  verifySecretToken(req) {
    if (!this.secretToken) {
      return true; // No secret token configured, allow all
    }

    const providedToken = req.headers['x-telegram-bot-api-secret-token'];
    return providedToken === this.secretToken;
  }
}

module.exports = TelegramWebhookController;

