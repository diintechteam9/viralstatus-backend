const { Telegraf } = require('telegraf');
require('dotenv').config();

class TelegramController {
  constructor() {
    this.bot = new Telegraf(process.env.TELEGRAMBOT_API_KEY);
    this.chatId = process.env.CHATID;
  }

  // Validate video format and size
  validateVideo(videoBuffer) {
    try {
      if (!videoBuffer || videoBuffer.length === 0) {
        return { valid: false, error: 'Video buffer is empty' };
      }

      // Check if it's a valid MP4 file by checking the first few bytes
      const header = videoBuffer.slice(0, 8);
      const isMP4 = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70; // 'ftyp'
      
      if (!isMP4) {
        return { valid: false, error: 'Video must be in MP4 format' };
      }

      // Check size limits
      const sizeMB = videoBuffer.length / (1024 * 1024);
      if (sizeMB > 100) { // 100MB absolute limit before compression
        return { valid: false, error: `Video too large: ${sizeMB.toFixed(2)}MB. Maximum allowed is 100MB.` };
      }

      return { 
        valid: true, 
        sizeMB: sizeMB,
        needsCompression: sizeMB > 50
      };
    } catch (error) {
      return { valid: false, error: `Video validation failed: ${error.message}` };
    }
  }

  // Compress video if it's too large
  async compressVideo(inputBuffer, targetSizeMB = 45) {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
      
      // Set FFmpeg path
      ffmpeg.setFfmpegPath(ffmpegInstaller.path);
      
      const tempDir = os.tmpdir();
      const inputPath = path.join(tempDir, `input_${Date.now()}.mp4`);
      const outputPath = path.join(tempDir, `compressed_${Date.now()}.mp4`);
      
      // Write input buffer to temp file
      fs.writeFileSync(inputPath, inputBuffer);
      
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-c:v', 'libx264',
            '-crf', '28', // Higher CRF = more compression
            '-preset', 'fast',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart'
          ])
          .output(outputPath)
          .on('end', async () => {
            try {
              // Read compressed video
              const compressedBuffer = fs.readFileSync(outputPath);
              
              // Clean up temp files
              if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
              if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
              
              resolve(compressedBuffer);
            } catch (error) {
              reject(error);
            }
          })
          .on('error', (error) => {
            // Clean up temp files
            try {
              if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
              if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            } catch (cleanupError) {
              console.warn('Cleanup error:', cleanupError.message);
            }
            reject(error);
          })
          .run();
      });
    } catch (error) {
      throw new Error(`Video compression failed: ${error.message}`);
    }
  }

  // Send text message to Telegram
  async sendTextMessage(text) {
    try {
      if (!this.chatId) {
        throw new Error('Chat ID not configured');
      }
      
      await this.bot.telegram.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
      return { success: true, message: 'Text sent to Telegram successfully' };
    } catch (error) {
      console.error('Error sending text to Telegram:', error);
      return { success: false, error: error.message };
    }
  }

  // Get video information for debugging
  getVideoInfo(videoBuffer) {
    try {
      if (!videoBuffer || videoBuffer.length === 0) {
        return { error: 'Empty video buffer' };
      }

      const sizeMB = videoBuffer.length / (1024 * 1024);
      const sizeKB = videoBuffer.length / 1024;
      
      // Check file signature
      const header = videoBuffer.slice(0, 12);
      let format = 'Unknown';
      let isValid = false;
      
      if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
        format = 'MP4';
        isValid = true;
      } else if (header[0] === 0x00 && header[1] === 0x00 && header[2] === 0x01) {
        format = 'MPEG';
        isValid = true;
      } else if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
        format = 'AVI';
        isValid = true;
      }

      return {
        sizeBytes: videoBuffer.length,
        sizeKB: sizeKB.toFixed(2),
        sizeMB: sizeMB.toFixed(2),
        format: format,
        isValid: isValid,
        telegramCompatible: sizeMB <= 50,
        needsCompression: sizeMB > 50,
        absoluteLimit: sizeMB <= 100
      };
    } catch (error) {
      return { error: `Failed to analyze video: ${error.message}` };
    }
  }

  // Send video to Telegram with retry logic
  async sendVideoWithRetry(videoBuffer, caption = '', maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries} to send video to Telegram`);
        
        // Try stream method first (better for large files)
        let result;
        if (attempt === 1) {
          result = await this.sendVideoAsStream(videoBuffer, caption);
        } else {
          // Fallback to regular method on retry
          result = await this.sendVideo(videoBuffer, caption);
        }
        
        if (result.success) {
          console.log(`Video sent successfully on attempt ${attempt}`);
          return result;
        } else {
          throw new Error(result.error);
        }
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          throw error; // Last attempt failed
        }
        
        // Wait before retrying (exponential backoff)
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
        console.log(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // Send video from stored file using stream
  async sendVideoFromFile(filename, caption = '') {
    try {
      if (!this.chatId) {
        throw new Error('Chat ID not configured');
      }

      // Import video storage service
      const VideoStorageService = require('../services/videoStorageService');
      const videoStorage = new VideoStorageService();
      
      // Get video file path
      const videoPath = videoStorage.getVideoPath(filename);
      if (!videoPath) {
        throw new Error('Video file not found or expired');
      }

      console.log(`Sending video file to Telegram using stream: ${filename}`);
      
      // Create file stream for Telegram
      const fs = require('fs');
      const videoStream = fs.createReadStream(videoPath);
      
      // Send video as stream (Telegram prefers this for larger files)
      await this.bot.telegram.sendVideo(this.chatId, { source: videoStream }, {
        caption: caption,
        supports_streaming: true,
        width: 720,
        height: 1280,
        duration: 0,
        parse_mode: 'HTML'
      });
      
      console.log('Video sent successfully to Telegram using stream method');
      
      return { success: true, message: 'Video sent to Telegram successfully using stream method' };

    } catch (error) {
      console.error('Error sending video file to Telegram:', error);
      return { success: false, error: error.message };
    }
  }

  // Send video using stream (better for large files)
  async sendVideoAsStream(videoBuffer, caption = '') {
    try {
      if (!this.chatId) {
        throw new Error('Chat ID not configured');
      }

      // Create buffer stream for Telegram
      const { Readable } = require('stream');
      const videoStream = Readable.from(videoBuffer);
      
      console.log('Sending video to Telegram using buffer stream...');
      
      // Send video as stream (Telegram prefers this for larger files)
      await this.bot.telegram.sendVideo(this.chatId, { source: videoStream }, {
        caption: caption,
        supports_streaming: true,
        width: 720,
        height: 1280,
        duration: 0,
        parse_mode: 'HTML'
      });
      
      console.log('Video sent successfully to Telegram using buffer stream method');
      
      return { success: true, message: 'Video sent to Telegram successfully using stream method' };

    } catch (error) {
      console.error('Error sending video stream to Telegram:', error);
      return { success: false, error: error.message };
    }
  }

  // Send video to Telegram
  async sendVideo(videoBuffer, caption = '') {
    try {
      if (!this.chatId) {
        throw new Error('Chat ID not configured');
      }

      // Check video buffer size (Telegram has 50MB limit for bots)
      const maxSize = 50 * 1024 * 1024; // 50MB in bytes
      let videoToSend = videoBuffer;
      let wasCompressed = false;
      
      if (videoBuffer.length > maxSize) {
        console.log(`Video size (${(videoBuffer.length / (1024 * 1024)).toFixed(2)}MB) exceeds Telegram limit. Attempting compression...`);
        
        try {
          videoToSend = await this.compressVideo(videoBuffer);
          wasCompressed = true;
          console.log(`Video compressed to ${(videoToSend.length / (1024 * 1024)).toFixed(2)}MB`);
          
          // Check if compression was successful and size is now acceptable
          if (videoToSend.length > maxSize) {
            throw new Error(`Video still too large after compression: ${(videoToSend.length / (1024 * 1024)).toFixed(2)}MB. Please try with a shorter video.`);
          }
        } catch (compressionError) {
          throw new Error(`Video too large (${(videoBuffer.length / (1024 * 1024)).toFixed(2)}MB) and compression failed: ${compressionError.message}`);
        }
      }

      // Send video directly using buffer instead of temporary file
      console.log('Sending video buffer to Telegram...');
      console.log(`Video buffer size: ${(videoToSend.length / (1024 * 1024)).toFixed(2)}MB`);
      console.log(`Video buffer type: ${typeof videoToSend}, is Buffer: ${Buffer.isBuffer(videoToSend)}`);
      
      // Ensure we have a proper buffer
      if (!Buffer.isBuffer(videoToSend)) {
        throw new Error('Video data is not a valid buffer');
      }
      
      // Validate the video format by checking the header
      const header = videoToSend.slice(0, 8);
      if (header[4] !== 0x66 || header[5] !== 0x74 || header[6] !== 0x79 || header[7] !== 0x70) {
        throw new Error('Video data does not appear to be a valid MP4 file');
      }
      
      console.log('Video buffer validation passed, sending to Telegram...');
      
      // Send video using buffer directly
      try {
        await this.bot.telegram.sendVideo(this.chatId, videoToSend, {
          caption: caption,
          supports_streaming: true,
          width: 720, // Set reasonable dimensions
          height: 1280,
          duration: 0, // Let Telegram auto-detect
          parse_mode: 'HTML'
        });
        
        console.log('Video sent successfully to Telegram using buffer method');
      } catch (bufferError) {
        console.log('Buffer method failed, trying file method as fallback...');
        
        // Fallback: Create temporary file and send as file
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        const tempDir = os.tmpdir();
        const tempFilePath = path.join(tempDir, `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`);
        
        try {
          // Write buffer to temp file
          fs.writeFileSync(tempFilePath, videoToSend);
          
          // Send video as file
          await this.bot.telegram.sendVideo(this.chatId, tempFilePath, {
            caption: caption,
            supports_streaming: true,
            width: 720,
            height: 1280,
            duration: 0,
            parse_mode: 'HTML'
          });
          
          console.log('Video sent successfully to Telegram using file method');
          
          // Clean up temp file
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (fileError) {
          // Clean up temp file
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
          throw new Error(`Both buffer and file methods failed. Buffer error: ${bufferError.message}, File error: ${fileError.message}`);
        }
      }
      
      console.log('Video sent successfully to Telegram');
      
      const message = wasCompressed 
        ? 'Video compressed and sent to Telegram successfully' 
        : 'Video sent to Telegram successfully';
      
      return { success: true, message: message, wasCompressed: wasCompressed };

    } catch (error) {
      console.error('Error sending video to Telegram:', error);
      
      // Log additional error details for debugging
      if (error.response) {
        console.error('Telegram API Response:', error.response);
      }
      if (error.on) {
        console.error('Telegram API Payload:', error.on);
      }
      
      // Provide more specific error messages
      if (error.message.includes('too large')) {
        return { success: false, error: error.message };
      } else if (error.message.includes('network')) {
        return { success: false, error: 'Network error while sending video. Please try again.' };
      } else if (error.message.includes('timeout')) {
        return { success: false, error: 'Video upload timed out. Please try again.' };
      } else if (error.message.includes('400: Bad Request')) {
        return { success: false, error: `Telegram API error: ${error.message}. This usually indicates an issue with the video format or size.` };
      } else if (error.message.includes('invalid file')) {
        return { success: false, error: `Invalid video file: ${error.message}. Please ensure the video is a valid MP4 file.` };
      } else {
        return { success: false, error: `Failed to send video: ${error.message}` };
      }
    }
  }

  

  // Test connection
  async testConnection() {
    try {
      if (!this.chatId) {
        throw new Error('Chat ID not configured');
      }
      
      await this.bot.telegram.sendMessage(this.chatId, '🤖 Bot connection test successful!');
      return { success: true, message: 'Telegram bot connection test successful' };
    } catch (error) {
      console.error('Telegram bot connection test failed:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = TelegramController;
