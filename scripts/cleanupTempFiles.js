const cleanupService = require('../services/cleanupService');
const path = require('path');

/**
 * Cleanup script for removing old temporary files
 * Run this script periodically (e.g., via cron job) to clean up old files
 */

async function runCleanup() {
  console.log('Starting cleanup of temporary files...');
  
  try {
    // Clean up files older than 24 hours
    const results = await cleanupService.cleanupOldFiles(24, './temp');
    
    console.log('Cleanup Results:');
    console.log(`- Successfully removed: ${results.success} files/directories`);
    console.log(`- Failed to remove: ${results.failed} files/directories`);
    
    if (results.errors.length > 0) {
      console.log('Errors encountered:');
      results.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    // Also clean up any files in the cleanup service's tracking list
    const tempFiles = cleanupService.getTempFiles();
    if (tempFiles.length > 0) {
      console.log(`Cleaning up ${tempFiles.length} tracked temporary files...`);
      const trackedResults = await cleanupService.cleanupAll();
      console.log(`Tracked files cleanup: ${trackedResults.success} successful, ${trackedResults.failed} failed`);
    }
    
    console.log('Cleanup completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  }
}

// Run cleanup if this script is executed directly
if (require.main === module) {
  runCleanup();
}

module.exports = runCleanup;
