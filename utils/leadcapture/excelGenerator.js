const XLSX = require('xlsx');

/**
 * Generate Excel file with phone number data
 */

// Create Excel workbook with phone number data
const generateExcelFile = (phoneNumbers, screenshots) => {
  // Create a new workbook
  const workbook = XLSX.utils.book_new();
  
  // Prepare data for the main sheet
  const mainData = phoneNumbers.map(phone => {
    return {
      'Phone Number': phone.formattedNumber,
      'Name': phone.name || 'N/A',
      'Email': phone.email || 'N/A',
    };
  });
  
  // Create main worksheet
  const mainWorksheet = XLSX.utils.json_to_sheet(mainData);
  
  // Set column widths
  const columnWidths = [
    { wch: 20 }, // Phone Number
    { wch: 25 }, // Name
    { wch: 30 }, // Email
  ];
  mainWorksheet['!cols'] = columnWidths;
  
  // Add the worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, mainWorksheet, 'Phone Numbers');
  
  // Create summary sheet
  const summaryData = [
    ['Total Phone Numbers', phoneNumbers.length],
    ['Valid Numbers', phoneNumbers.filter(p => p.isValid).length],
    ['Invalid Numbers', phoneNumbers.filter(p => !p.isValid).length],
    ['Average Confidence', (phoneNumbers.reduce((sum, p) => sum + p.confidence, 0) / phoneNumbers.length * 100).toFixed(1) + '%'],
    ['Unique Screenshots', screenshots.length],
    ['Extraction Date', new Date().toLocaleDateString()]
  ];
  
  const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryData);
  summaryWorksheet['!cols'] = [{ wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
  
  // Create country code breakdown sheet
  const countryBreakdown = {};
  phoneNumbers.forEach(phone => {
    const country = phone.countryCode || 'Unknown';
    countryBreakdown[country] = (countryBreakdown[country] || 0) + 1;
  });
  
  const countryData = Object.entries(countryBreakdown).map(([country, count]) => ({
    'Country Code': country,
    'Count': count,
    'Percentage': ((count / phoneNumbers.length) * 100).toFixed(1) + '%'
  }));
  
  const countryWorksheet = XLSX.utils.json_to_sheet(countryData);
  countryWorksheet['!cols'] = [{ wch: 15 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(workbook, countryWorksheet, 'Country Breakdown');
  
  return workbook;
};

// Generate Excel buffer for download
const generateExcelBuffer = (phoneNumbers, screenshots) => {
  const workbook = generateExcelFile(phoneNumbers, screenshots);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

// Generate Excel file and save to disk
const generateExcelFileToDisk = (phoneNumbers, screenshots, filePath) => {
  const workbook = generateExcelFile(phoneNumbers, screenshots);
  XLSX.writeFile(workbook, filePath);
  return filePath;
};

// Generate CSV format
const generateCSV = (phoneNumbers, screenshots) => {
  const data = phoneNumbers.map(phone => {
    return {
      'Phone Number': phone.formattedNumber,
      'Name': phone.name || 'N/A',
      'Email': phone.email || 'N/A',
      'Valid': phone.isValid,
      'Extracted Date': new Date(phone.createdAt).toISOString()
    };
  });
  
  const worksheet = XLSX.utils.json_to_sheet(data);
  return XLSX.utils.sheet_to_csv(worksheet);
};

module.exports = {
  generateExcelFile,
  generateExcelBuffer,
  generateExcelFileToDisk,
  generateCSV
};
