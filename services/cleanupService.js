const fs = require('fs').promises;
const path = require('path');

/**
 * Cleanup service for removing temporary files after video compression
 */
class CleanupService {
  constructor() {
    this.tempDirectories = new Set();
  }

  /**
   * Add temporary file to cleanup list
   * @param {string} filePath - Path to temporary file
   */
  addTempFile(filePath) {
    if (filePath) {
      this.tempDirectories.add(filePath);
    }
  }

  /**
   * Add multiple temporary files to cleanup list
   * @param {Array<string>} filePaths - Array of file paths
   */
  addTempFiles(filePaths) {
    if (Array.isArray(filePaths)) {
      filePaths.forEach(filePath => this.addTempFile(filePath));
    }
  }

  /**
   * Remove a single file
   * @param {string} filePath - Path to file to remove
   * @returns {Promise<boolean>} Success status
   */
  async removeFile(filePath) {
    try {
      if (!filePath) return true;
      
      await fs.access(filePath);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true;
      }
      return false;
    }
  }

  /**
   * Remove a directory and all its contents
   * @param {string} dirPath - Path to directory to remove
   * @returns {Promise<boolean>} Success status
   */
  async removeDirectory(dirPath) {
    try {
      if (!dirPath) return true;
      
      await fs.access(dirPath);
      const stats = await fs.stat(dirPath);
      
      if (!stats.isDirectory()) {
        return await this.removeFile(dirPath);
      }

      const files = await fs.readdir(dirPath);
      
      // Remove all files in directory
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const fileStats = await fs.stat(filePath);
        
        if (fileStats.isDirectory()) {
          await this.removeDirectory(filePath);
        } else {
          await this.removeFile(filePath);
        }
      }
      
      // Remove the directory itself
      await fs.rmdir(dirPath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true;
      }
      return false;
    }
  }

  /**
   * Clean up all temporary files
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupAll() {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const tempPath of this.tempDirectories) {
      try {
        const stats = await fs.stat(tempPath);
        const success = stats.isDirectory() 
          ? await this.removeDirectory(tempPath)
          : await this.removeFile(tempPath);
        
        if (success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`Failed to remove: ${tempPath}`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`Error with ${tempPath}: ${error.message}`);
      }
    }

    // Clear the set after cleanup
    this.tempDirectories.clear();
    
    return results;
  }

  /**
   * Clean up specific files from a job
   * @param {Array<string>} filePaths - Array of file paths to clean up
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupJobFiles(filePaths) {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return results;
    }

    for (const filePath of filePaths) {
      try {
        const stats = await fs.stat(filePath);
        const success = stats.isDirectory() 
          ? await this.removeDirectory(filePath)
          : await this.removeFile(filePath);
        
        if (success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`Failed to remove: ${filePath}`);
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`Error with ${filePath}: ${error.message}`);
        }
      }
    }

    return results;
  }

  /**
   * Clean up old temporary files (older than specified hours)
   * @param {number} hoursOld - Files older than this many hours will be removed
   * @param {string} tempDir - Temporary directory to clean
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupOldFiles(hoursOld = 24, tempDir = './temp') {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    try {
      const files = await fs.readdir(tempDir);
      const cutoffTime = Date.now() - (hoursOld * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(tempDir, file);
        
        try {
          const stats = await fs.stat(filePath);
          
          if (stats.mtime.getTime() < cutoffTime) {
            const success = stats.isDirectory() 
              ? await this.removeDirectory(filePath)
              : await this.removeFile(filePath);
            
            if (success) {
              results.success++;
            } else {
              results.failed++;
              results.errors.push(`Failed to remove old file: ${filePath}`);
            }
          }
        } catch (error) {
          results.failed++;
          results.errors.push(`Error checking ${filePath}: ${error.message}`);
        }
      }
    } catch (error) {
      results.errors.push(`Error accessing temp directory: ${error.message}`);
    }

    return results;
  }

  /**
   * Get list of current temporary files
   * @returns {Array<string>} Array of temporary file paths
   */
  getTempFiles() {
    return Array.from(this.tempDirectories);
  }

  /**
   * Clear the temporary files list without removing files
   */
  clearTempFilesList() {
    this.tempDirectories.clear();
  }
}

// Create singleton instance
const cleanupService = new CleanupService();

module.exports = cleanupService;
