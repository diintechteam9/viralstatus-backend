const fs = require('fs');
const path = require('path');

/**
 * Clean up uploaded files after processing
 * @param {string} filePath - Path to the file to be deleted
 * @param {string} filename - Name of the file for logging
 * @returns {Promise<boolean>} - Success status
 */
const cleanupFile = async (filePath, filename = '') => {
  try {
    if (!filePath) {
      console.log('No file path provided for cleanup');
      return false;
    }

    // Check if file exists
    if (fs.existsSync(filePath)) {
      // Delete the file
      fs.unlinkSync(filePath);
      console.log(`✅ File cleaned up successfully: ${filename || path.basename(filePath)}`);
      return true;
    } else {
      console.log(`⚠️ File not found for cleanup: ${filename || path.basename(filePath)}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error cleaning up file ${filename || path.basename(filePath)}:`, error.message);
    return false;
  }
};

/**
 * Clean up multiple files
 * @param {Array} files - Array of file objects with path and filename
 * @returns {Promise<Object>} - Cleanup results
 */
const cleanupFiles = async (files) => {
  const results = {
    success: [],
    failed: [],
    total: files.length
  };

  for (const file of files) {
    const success = await cleanupFile(file.path, file.filename);
    if (success) {
      results.success.push(file.filename || path.basename(file.path));
    } else {
      results.failed.push(file.filename || path.basename(file.path));
    }
  }

  console.log(`🧹 Cleanup completed: ${results.success.length}/${results.total} files cleaned successfully`);
  return results;
};

/**
 * Clean up old files from uploads directory (optional utility for batch cleanup)
 * @param {string} uploadsDir - Path to uploads directory
 * @param {number} olderThanDays - Delete files older than X days
 * @returns {Promise<Object>} - Cleanup results
 */
const cleanupOldFiles = async (uploadsDir, olderThanDays = 7) => {
  try {
    const files = fs.readdirSync(uploadsDir);
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const filesToDelete = [];

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isFile() && stats.mtime < cutoffDate) {
        filesToDelete.push({
          path: filePath,
          filename: file
        });
      }
    }

    if (filesToDelete.length > 0) {
      console.log(`🗑️ Found ${filesToDelete.length} old files to clean up`);
      return await cleanupFiles(filesToDelete);
    } else {
      console.log('✅ No old files found for cleanup');
      return { success: [], failed: [], total: 0 };
    }
  } catch (error) {
    console.error('❌ Error cleaning up old files:', error.message);
    return { success: [], failed: [], total: 0 };
  }
};

/**
 * Clean up all files in uploads directory (use with caution)
 * @param {string} uploadsDir - Path to uploads directory
 * @returns {Promise<Object>} - Cleanup results
 */
const cleanupAllUploads = async (uploadsDir) => {
  try {
    const files = fs.readdirSync(uploadsDir);
    const filesToDelete = [];

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isFile()) {
        filesToDelete.push({
          path: filePath,
          filename: file
        });
      }
    }

    if (filesToDelete.length > 0) {
      console.log(`🧹 Cleaning up ${filesToDelete.length} files from uploads directory`);
      return await cleanupFiles(filesToDelete);
    } else {
      console.log('✅ Uploads directory is already clean');
      return { success: [], failed: [], total: 0 };
    }
  } catch (error) {
    console.error('❌ Error cleaning up uploads directory:', error.message);
    return { success: [], failed: [], total: 0 };
  }
};

module.exports = {
  cleanupFile,
  cleanupFiles,
  cleanupOldFiles,
  cleanupAllUploads
};
