const Tesseract = require('tesseract.js');
const fs = require('fs');
const { 
  extractPhoneNumbers, 
  findAssociatedName, 
  findAssociatedEmail 
} = require('./phoneExtractor');

/**
 * Extract text from an image file using Tesseract.js
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<string>} - Extracted text
 */
const extractTextFromImage = async (imagePath) => {
  try {
    console.log('🔍 Starting OCR processing for:', imagePath);
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      throw new Error('Image file not found');
    }

    // Get file stats for debugging
    const stats = fs.statSync(imagePath);
    console.log('📁 File stats:', {
      size: stats.size,
      modified: stats.mtime,
      exists: true
    });

    // Initialize Tesseract worker with English language
    const worker = await Tesseract.createWorker('eng');
    
    try {
      // Configure OCR for better text extraction (removed restrictive whitelist)
      await worker.setParameters({
        tessedit_pageseg_mode: '1', // Automatic page segmentation with OSD
        tessedit_ocr_engine_mode: '1', // Neural nets LSTM engine only
        tessedit_char_blacklist: '', // No character blacklist
        preserve_interword_spaces: '1', // Preserve spaces between words
      });

      console.log('⚙️ OCR parameters configured, starting recognition...');

      // Perform OCR
      const { data: { text, confidence } } = await worker.recognize(imagePath);
      
      // Terminate worker
      await worker.terminate();
      
      console.log('✅ OCR completed successfully');
      console.log('📊 OCR Results:', {
        textLength: text ? text.length : 0,
        confidence: confidence,
        hasText: !!text && text.trim().length > 0
      });
      
      if (text && text.trim().length > 0) {
        console.log('📝 Extracted text preview:', text.substring(0, 200) + (text.length > 200 ? '...' : ''));
      } else {
        console.log('⚠️ No text extracted from image');
      }
      
      return text || '';
    } catch (workerError) {
      console.error('❌ Worker error:', workerError);
      await worker.terminate();
      throw workerError;
    }
  } catch (error) {
    console.error('❌ OCR processing failed:', error);
    throw new Error(`Failed to extract text from image: ${error.message}`);
  }
};


/**
 * Extract phone numbers, names, and emails from an image
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<Array>} - Array of extracted data objects
 */
const extractContactData = async (imagePath) => {
  try {
    console.log('Starting contact data extraction for:', imagePath);
    
    // Extract text from image
    const text = await extractTextFromImage(imagePath);
    
    if (!text || text.trim().length === 0) {
      console.log('No text extracted from image');
      return [];
    }
    
    console.log('Extracted text length:', text.length);
    
    // Extract phone numbers
    const phoneNumbers = extractPhoneNumbers(text);
    console.log('Found phone numbers:', phoneNumbers.length);
    
    // For each phone number, find associated name and email
    const contactData = phoneNumbers.map(phoneData => {
      const associatedName = findAssociatedName(phoneData.original, text);
      const associatedEmail = findAssociatedEmail(phoneData.original, text);
      
      console.log(`Phone: ${phoneData.original}, Name: ${associatedName}, Email: ${associatedEmail}`);
      
      return {
        phoneNumber: phoneData.cleaned,
        formattedNumber: phoneData.formatted,
        countryCode: phoneData.countryCode,
        isValid: phoneData.isValid,
        name: associatedName || '',
        email: associatedEmail || '',
        context: text.substring(0, 200) // Store first 200 chars as context
      };
    });
    
    console.log('Contact data extraction completed:', contactData.length, 'contacts found');
    return contactData;
  } catch (error) {
    console.error('Contact data extraction failed:', error);
    throw new Error(`Failed to extract contact data from image: ${error.message}`);
  }
};

/**
 * Extract contact data with progress callback
 * @param {string} imagePath - Path to the image file
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<Array>} - Array of extracted data objects
 */
const extractContactDataWithProgress = async (imagePath, onProgress) => {
  try {
    console.log('🚀 Starting contact data extraction with progress tracking for:', imagePath);
    
    // Simulate progress updates since Tesseract progress callback doesn't work in Node.js
    if (onProgress) {
      onProgress(10); // Starting OCR
    }
    
    // Extract text from image
    const text = await extractTextFromImage(imagePath);
    
    if (onProgress) {
      onProgress(50); // OCR completed
    }
    
    if (!text || text.trim().length === 0) {
      console.log('⚠️ No text extracted from image');
      if (onProgress) {
        onProgress(100); // Complete
      }
      return [];
    }
    
      console.log('📝 Extracted text length:', text.length);
      console.log('📄 Full extracted text:', text);
      
      // Debug: Show text analysis
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      console.log('📋 Text lines:', lines.length);
      console.log('📋 First few lines:', lines.slice(0, 5));
      
      // Debug: Show all digit sequences found
      const digitSequences = text.match(/\d{7,15}/g) || [];
      console.log('🔢 All digit sequences found:', digitSequences);
      
      // Debug: Show potential phone patterns
      const phoneLikePatterns = text.match(/\b\d{10,11}\b/g) || [];
      console.log('📱 Phone-like patterns found:', phoneLikePatterns);
      
      // Debug: Show potential names
      const namePatterns = text.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || [];
      console.log('👤 Potential names found:', namePatterns);
      
      // Debug: Show potential emails
      const emailPatterns = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      console.log('📧 Potential emails found:', emailPatterns);
      
      // Extract phone numbers
      const phoneNumbers = extractPhoneNumbers(text);
      console.log('📞 Found phone numbers:', phoneNumbers.length);
      
      if (phoneNumbers.length > 0) {
        console.log('📞 Phone numbers found:', phoneNumbers.map(p => ({
          original: p.original,
          cleaned: p.cleaned,
          formatted: p.formatted,
          isValid: p.isValid,
          countryCode: p.countryCode
        })));
      } else {
        console.log('❌ No phone numbers detected in text');
        console.log('🔍 Debug: Text analysis complete - no valid phone numbers found');
      }
    
    if (onProgress) {
      onProgress(75); // Phone numbers extracted
    }
    
    // For each phone number, find associated name and email
    const contactData = phoneNumbers.map(phoneData => {
      const associatedName = findAssociatedName(phoneData.original, text);
      const associatedEmail = findAssociatedEmail(phoneData.original, text);
      
      console.log(`📋 Contact: Phone: ${phoneData.original}, Name: ${associatedName}, Email: ${associatedEmail}`);
      
      return {
        phoneNumber: phoneData.cleaned,
        formattedNumber: phoneData.formatted,
        countryCode: phoneData.countryCode,
        isValid: phoneData.isValid,
        name: associatedName || '',
        email: associatedEmail || '',
        context: text.substring(0, 200) // Store first 200 chars as context
      };
    });
    
    if (onProgress) {
      onProgress(100); // Complete
    }
    
    console.log('✅ Contact data extraction completed:', contactData.length, 'contacts found');
    return contactData;
  } catch (error) {
    console.error('❌ Contact data extraction failed:', error);
    throw new Error(`Failed to extract contact data from image: ${error.message}`);
  }
};

module.exports = {
  extractTextFromImage,
  extractContactData,
  extractContactDataWithProgress
};
