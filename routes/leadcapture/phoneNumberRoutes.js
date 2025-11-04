const express = require('express');
const {
  getAllPhoneNumbers,
  getPhoneNumber,
  updatePhoneNumber,
  deletePhoneNumber,
  deleteAllPhoneNumbers,
  getPhoneNumberStats,
  exportToExcel,
  exportToCSV
} = require('../../controllers/leadcapture/phoneNumberController');

const router = express.Router();

// Routes
router.get('/', getAllPhoneNumbers);
router.get('/stats', getPhoneNumberStats);
router.get('/export/excel', exportToExcel);
router.get('/export/csv', exportToCSV);
router.delete('/delete-all', deleteAllPhoneNumbers);
router.get('/:phoneNumberId', getPhoneNumber);
router.put('/:phoneNumberId', updatePhoneNumber);
router.delete('/:phoneNumberId', deletePhoneNumber);

module.exports = router;
