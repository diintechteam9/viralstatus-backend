/**
 * Utility functions for extracting and validating phone numbers from text
 */

// Comprehensive phone number patterns (works for any country)
const PHONE_PATTERNS = [
  // International formats
  /\+[1-9]\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g, // International format
  /\+[1-9]\d{6,14}/g, // International format without separators
  
  // Indian specific patterns
  /\+91[-.\s]?[6-9]\d{9}/g, // +91 followed by 10-digit mobile
  /\+91[-.\s]?0[6-9]\d{9}/g, // +91 followed by 0 and 10-digit mobile
  /0[6-9]\d{9}/g, // 0 followed by 10-digit mobile
  /\b[6-9]\d{9}\b/g, // 10-digit mobile number
  
  // US/Canada patterns
  /\+1[-.\s]?[2-9]\d{2}[-.\s]?\d{3}[-.\s]?\d{4}/g, // US/Canada format
  /[2-9]\d{2}[-.\s]?\d{3}[-.\s]?\d{4}/g, // US/Canada without country code
  
  // UK patterns
  /\+44[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g, // UK format
  
  // Generic patterns for any country
  /\b\d{7,15}\b/g, // Any 7-15 digit number
  /\b\d{10,11}\b/g, // 10-11 digit numbers (common mobile length)
  /\b\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g, // Formatted numbers
  /\b\d{4}[-.\s]?\d{3}[-.\s]?\d{3}\b/g, // 4-3-3 format
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // 3-3-4 format
  
  // Patterns with parentheses (US style)
  /\([2-9]\d{2}\)[-.\s]?\d{3}[-.\s]?\d{4}/g, // (XXX) XXX-XXXX format
  
  // Patterns with extensions
  /\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?(?:ext|x|extension)[-.\s]?\d{1,5}/gi, // With extension
];

// Clean phone number by removing non-digit characters except +
const cleanPhoneNumber = (phoneNumber) => {
  return phoneNumber.replace(/[^\d+]/g, '');
};

// Format phone number for display (Indian format)
const formatPhoneNumber = (phoneNumber) => {
  const cleaned = cleanPhoneNumber(phoneNumber);
  
  // Handle +91 format
  if (cleaned.startsWith('+91')) {
    const number = cleaned.substring(3); // Remove +91
    if (number.length === 10) {
      return `+91 ${number.slice(0, 5)} ${number.slice(5)}`; // +91 XXXXX XXXXX
    } else if (number.length === 11 && number.startsWith('0')) {
      const mobileNumber = number.substring(1); // Remove leading 0
      return `+91 ${mobileNumber.slice(0, 5)} ${mobileNumber.slice(5)}`; // +91 XXXXX XXXXX
    }
  }
  
  // Handle 0 prefix format
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const mobileNumber = cleaned.substring(1); // Remove leading 0
    return `+91 ${mobileNumber.slice(0, 5)} ${mobileNumber.slice(5)}`; // +91 XXXXX XXXXX
  }
  
  // Handle 10-digit format (assume Indian mobile)
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`; // +91 XXXXX XXXXX
  }
  
  // Handle 11-digit format starting with 0
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    const mobileNumber = cleaned.substring(1);
    return `+91 ${mobileNumber.slice(0, 5)} ${mobileNumber.slice(5)}`; // +91 XXXXX XXXXX
  }
  
  // Default format
  return cleaned;
};

// Extract country code from phone number (works for any country)
const extractCountryCode = (phoneNumber) => {
  const cleaned = cleanPhoneNumber(phoneNumber);
  
  // Extract country code from international format
  if (cleaned.startsWith('+')) {
    // Common country codes
    if (cleaned.startsWith('+1')) return '1'; // US/Canada
    if (cleaned.startsWith('+44')) return '44'; // UK
    if (cleaned.startsWith('+91')) return '91'; // India
    if (cleaned.startsWith('+86')) return '86'; // China
    if (cleaned.startsWith('+81')) return '81'; // Japan
    if (cleaned.startsWith('+49')) return '49'; // Germany
    if (cleaned.startsWith('+33')) return '33'; // France
    if (cleaned.startsWith('+39')) return '39'; // Italy
    if (cleaned.startsWith('+34')) return '34'; // Spain
    if (cleaned.startsWith('+55')) return '55'; // Brazil
    if (cleaned.startsWith('+61')) return '61'; // Australia
    if (cleaned.startsWith('+7')) return '7'; // Russia/Kazakhstan
    
    // Generic extraction for other countries
    const match = cleaned.match(/^\+(\d{1,3})/);
    if (match) return match[1];
  }
  
  // Default assumptions based on number length and format
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return '91'; // Indian mobile
  }
  
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    return '91'; // Indian with leading 0
  }
  
  if (cleaned.length === 10 && /^[2-9]/.test(cleaned)) {
    return '1'; // US/Canada
  }
  
  // Default fallback
  return 'unknown';
};

// Validate phone number (works for any country)
const isValidPhoneNumber = (phoneNumber) => {
  const cleaned = cleanPhoneNumber(phoneNumber);
  
  // Must contain only digits and optional leading +
  if (!/^\+?\d+$/.test(cleaned)) {
    return false;
  }
  
  // International format validation
  if (cleaned.startsWith('+')) {
    // Must be 7-15 digits after country code
    const numberPart = cleaned.substring(1);
    return numberPart.length >= 7 && numberPart.length <= 15;
  }
  
  // Local format validation (7-15 digits)
  return cleaned.length >= 7 && cleaned.length <= 15;
};

// Extract phone numbers from text using multiple patterns
const extractPhoneNumbers = (text) => {
  console.log('🔍 Starting phone number extraction from text:', text.substring(0, 200) + (text.length > 200 ? '...' : ''));
  
  const phoneNumbers = new Set();
  
  // First, try to find all sequences of digits that could be phone numbers
  const digitSequences = text.match(/\d{7,15}/g) || [];
  console.log('🔢 Found digit sequences:', digitSequences);
  
  digitSequences.forEach(sequence => {
    console.log(`🔍 Checking sequence: "${sequence}"`);
    // Check if this sequence looks like a valid phone number
    if (isValidPhoneNumber(sequence)) {
      console.log(`✅ Valid phone number found: "${sequence}"`);
      phoneNumbers.add(sequence);
    } else {
      console.log(`❌ Invalid phone number: "${sequence}"`);
    }
  });
  
  // Then apply regex patterns
  console.log('🔍 Applying regex patterns...');
  PHONE_PATTERNS.forEach((pattern, index) => {
    const matches = text.match(pattern);
    if (matches) {
      console.log(`📞 Pattern ${index + 1} found matches:`, matches);
      matches.forEach(match => {
        const cleaned = cleanPhoneNumber(match);
        console.log(`🔧 Cleaned match: "${match}" -> "${cleaned}"`);
        if (isValidPhoneNumber(cleaned)) {
          console.log(`✅ Valid phone number from pattern: "${cleaned}"`);
          phoneNumbers.add(cleaned);
        } else {
          console.log(`❌ Invalid phone number from pattern: "${cleaned}"`);
        }
      });
    }
  });
  
  console.log('📞 Final phone numbers set:', Array.from(phoneNumbers));
  
  const result = Array.from(phoneNumbers).map(phoneNumber => {
    const cleaned = cleanPhoneNumber(phoneNumber);
    const countryCode = extractCountryCode(phoneNumber);
    
    // Normalize to standard format for storage
    let normalizedNumber = cleaned;
    if (cleaned.startsWith('+')) {
      // For international numbers, keep the full number
      normalizedNumber = cleaned;
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
      // Remove leading 0 for local numbers
      normalizedNumber = cleaned.substring(1);
    }
    
    const result = {
      original: phoneNumber,
      cleaned: normalizedNumber,
      formatted: formatPhoneNumber(phoneNumber),
      countryCode: countryCode,
      isValid: isValidPhoneNumber(phoneNumber)
    };
    
    console.log(`📋 Processed phone number:`, result);
    return result;
  });
  
  console.log('✅ Phone number extraction completed. Found:', result.length, 'numbers');
  return result;
};

// Calculate confidence score based on pattern matching and context
const calculateConfidence = (phoneNumber, context) => {
  let confidence = 0.5; // Base confidence
  
  const cleaned = cleanPhoneNumber(phoneNumber);
  
  // Length-based confidence
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    confidence += 0.2;
  }
  
  // Format-based confidence
  if (/^\+?\d{10,15}$/.test(cleaned)) {
    confidence += 0.2;
  }
  
  // Context-based confidence
  const contextLower = context.toLowerCase();
  const phoneKeywords = ['phone', 'call', 'contact', 'mobile', 'tel', 'number'];
  if (phoneKeywords.some(keyword => contextLower.includes(keyword))) {
    confidence += 0.1;
  }
  
  return Math.min(confidence, 1.0);
};

// Email validation regex
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Name patterns - comprehensive patterns for any country
const NAME_PATTERNS = [
  // Full name patterns
  /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, // First Last format
  /\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+\b/g, // First Middle Last format
  /\b[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+\b/g, // Four part names
  
  // Single names (capitalized)
  /\b[A-Z][a-z]+\b/g, // Single name (capitalized)
  
  // Names with hyphens or apostrophes
  /\b[A-Z][a-z]+[-'][A-Z][a-z]+\b/g, // Names with hyphens or apostrophes
  
  // Names with common prefixes
  /\b(?:Mr|Mrs|Ms|Dr|Prof|Sir|Madam)[.\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/gi, // With titles
  
  // Names in quotes or brackets
  /["']([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)["']/g, // Names in quotes
  /\[([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\]/g, // Names in brackets
];

// Extract email addresses from text
const extractEmails = (text) => {
  const emails = text.match(EMAIL_REGEX) || [];
  return emails.map(email => email.toLowerCase().trim());
};

// Extract potential names from text
const extractNames = (text) => {
  const names = new Set();
  
  // Split text into lines for better context
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  lines.forEach(line => {
    // Skip lines that are clearly not names (contain numbers, special chars, etc.)
    if (/\d{3,}/.test(line) || line.includes('@') || line.includes('http') || line.includes('www')) {
      return;
    }
    
    // Apply name patterns
    NAME_PATTERNS.forEach(pattern => {
      const matches = line.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Additional validation for names
          if (isValidName(match)) {
            names.add(match.trim());
          }
        });
      }
    });
  });
  
  return Array.from(names);
};

// Validate if a string looks like a name
const isValidName = (name) => {
  // Must be at least 2 characters
  if (name.length < 2) return false;
  
  // Must contain only letters, spaces, hyphens, apostrophes, and periods
  if (!/^[A-Za-z\s\-'\.]+$/.test(name)) return false;
  
  // Must start with capital letter
  if (!/^[A-Z]/.test(name)) return false;
  
  // Must not be too long (likely not a name)
  if (name.length > 50) return false;
  
  // Must not be too short (likely not a full name)
  if (name.length < 3) return false;
  
  // Must not be common non-name words
  const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'phone', 'call', 'contact', 'mobile', 'number', 'email', 'address', 'name', 'mr', 'mrs', 'ms', 'dr', 'prof', 'company', 'ltd', 'inc', 'corp', 'llc', 'pvt', 'limited', 'private', 'public', 'group', 'enterprises', 'solutions', 'services', 'technologies', 'systems', 'international', 'global', 'worldwide', 'india', 'usa', 'uk', 'canada', 'australia', 'germany', 'france', 'japan', 'china', 'brazil', 'russia', 'spain', 'italy'];
  const lowerName = name.toLowerCase().trim();
  if (commonWords.includes(lowerName)) return false;
  
  // Must not contain numbers
  if (/\d/.test(name)) return false;
  
  // Must not be all uppercase (likely not a name)
  if (name === name.toUpperCase() && name.length > 3) return false;
  
  return true;
};

// Find the most likely name associated with a phone number
const findAssociatedName = (phoneNumber, text) => {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Find the line containing the phone number
  let phoneLineIndex = -1;
  lines.forEach((line, index) => {
    if (line.includes(phoneNumber)) {
      phoneLineIndex = index;
    }
  });
  
  if (phoneLineIndex === -1) return '';
  
  // Look for names in the same line or nearby lines (expanded search)
  const searchLines = lines.slice(Math.max(0, phoneLineIndex - 3), phoneLineIndex + 4);
  const names = extractNames(searchLines.join('\n'));
  
  // Filter out names that are too close to phone numbers (likely not names)
  const filteredNames = names.filter(name => {
    const nameLower = name.toLowerCase();
    const phoneLower = phoneNumber.toLowerCase();
    
    // Skip if name contains phone number or vice versa
    if (nameLower.includes(phoneLower) || phoneLower.includes(nameLower)) {
      return false;
    }
    
    // Skip if name is very short
    if (name.length < 3) return false;
    
    return true;
  });
  
  // Return the first valid name found, or the longest one if multiple
  if (filteredNames.length > 0) {
    return filteredNames.reduce((longest, current) => 
      current.length > longest.length ? current : longest
    );
  }
  
  return '';
};

// Find the most likely email associated with a phone number
const findAssociatedEmail = (phoneNumber, text) => {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Find the line containing the phone number
  let phoneLineIndex = -1;
  lines.forEach((line, index) => {
    if (line.includes(phoneNumber)) {
      phoneLineIndex = index;
    }
  });
  
  if (phoneLineIndex === -1) return '';
  
  // Look for emails in the same line or nearby lines (expanded search)
  const searchLines = lines.slice(Math.max(0, phoneLineIndex - 3), phoneLineIndex + 4);
  const emails = extractEmails(searchLines.join('\n'));
  
  // Filter out emails that might be false positives
  const filteredEmails = emails.filter(email => {
    // Basic email validation
    if (!email.includes('@') || !email.includes('.')) return false;
    
    // Skip emails that are too short or too long
    if (email.length < 5 || email.length > 100) return false;
    
    // Skip emails that contain phone numbers
    if (/\d{7,}/.test(email)) return false;
    
    return true;
  });
  
  // Return the first valid email found
  return filteredEmails.length > 0 ? filteredEmails[0] : '';
};

module.exports = {
  extractPhoneNumbers,
  cleanPhoneNumber,
  formatPhoneNumber,
  extractCountryCode,
  isValidPhoneNumber,
  calculateConfidence,
  extractEmails,
  extractNames,
  findAssociatedName,
  findAssociatedEmail
};
