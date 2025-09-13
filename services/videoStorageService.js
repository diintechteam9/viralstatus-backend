const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class VideoStorageService {
  constructor() {
    this.storageDir = path.join(__dirname, '../temp/videos');
    this.cleanupInterval = 5 * 60 * 1000; // 5 min in milliseconds
    this.videoMetadata = new Map(); // Store video info and expiry times
    
    // Ensure storage directory exists
    this.ensureStorageDir();
    
    // Start cleanup interval
    this.startCleanupInterval();
    
    console.log('VideoStorageService initialized. Storage directory:', this.storageDir);
  }

  ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  // Generate unique filename for video
  generateVideoFilename() {
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(8).toString('hex');
    return `video_${timestamp}_${randomId}.mp4`;
  }

  // Store video temporarily
  async storeVideo(videoBuffer, metadata = {}) {
    try {
      const filename = this.generateVideoFilename();
      const filePath = path.join(this.storageDir, filename);
      
      // Write video to file
      fs.writeFileSync(filePath, videoBuffer);
      
      // Store metadata with expiry time (5 min from now)
      const expiryTime = Date.now() + this.cleanupInterval;
      this.videoMetadata.set(filename, {
        filePath,
        expiryTime,
        size: videoBuffer.length,
        createdAt: Date.now(),
        ...metadata
      });
      
      console.log(`Video stored temporarily: ${filename} (${(videoBuffer.length / (1024 * 1024)).toFixed(2)}MB)`);
      
      return {
        filename,
        filePath,
        url: `/api/video/stream/${filename}`,
        expiryTime: new Date(expiryTime).toISOString()
      };
    } catch (error) {
      console.error('Error storing video:', error);
      throw new Error(`Failed to store video: ${error.message}`);
    }
  }

  // Get video file path
  getVideoPath(filename) {
    const metadata = this.videoMetadata.get(filename);
    if (!metadata) {
      return null;
    }
    
    // Check if file still exists
    if (!fs.existsSync(metadata.filePath)) {
      this.videoMetadata.delete(filename);
      return null;
    }
    
    return metadata.filePath;
  }

  // Get video metadata
  getVideoMetadata(filename) {
    return this.videoMetadata.get(filename);
  }

  // Delete video file
  deleteVideo(filename) {
    try {
      const metadata = this.videoMetadata.get(filename);
      if (metadata && fs.existsSync(metadata.filePath)) {
        fs.unlinkSync(metadata.filePath);
        console.log(`Video deleted: ${filename}`);
      }
      this.videoMetadata.delete(filename);
      return true;
    } catch (error) {
      console.error(`Error deleting video ${filename}:`, error);
      return false;
    }
  }

  // Cleanup expired videos
  cleanupExpiredVideos() {
    const now = Date.now();
    const expiredVideos = [];
    
    for (const [filename, metadata] of this.videoMetadata.entries()) {
      if (now >= metadata.expiryTime) {
        expiredVideos.push(filename);
      }
    }
    
    if (expiredVideos.length > 0) {
      console.log(`Cleaning up ${expiredVideos.length} expired videos...`);
      expiredVideos.forEach(filename => {
        this.deleteVideo(filename);
      });
    }
  }

  // Start cleanup interval
  startCleanupInterval() {
    // Run cleanup every 15 minutes
    setInterval(() => {
      this.cleanupExpiredVideos();
    }, 15 * 60 * 1000); // 15 minutes
    
    console.log('Video cleanup interval started (every 15 minutes)');
  }

  // Get storage statistics
  getStorageStats() {
    const totalVideos = this.videoMetadata.size;
    let totalSize = 0;
    
    for (const metadata of this.videoMetadata.values()) {
      totalSize += metadata.size;
    }
    
    return {
      totalVideos,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      storageDir: this.storageDir
    };
  }

  // Manual cleanup (for testing or admin purposes)
  forceCleanup() {
    console.log('Force cleanup initiated...');
    this.cleanupExpiredVideos();
    return this.getStorageStats();
  }
}

module.exports = VideoStorageService;
