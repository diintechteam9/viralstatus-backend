const express = require('express');
const router = express.Router();
const { 
  getTemplates, 
  createTemplate, 
  listTemplates,
  getPendingTemplates,
  getRejectedTemplates,
  getApprovedTemplates,
  checkTemplateNameExists
} = require('../../controllers/whatsapp/whatsapptemplatecontroller');

// to get the list of template from the facebook business account 
router.get('/get-templates', getTemplates);

// Create and submit a template to Meta
router.post('/templates', createTemplate);

// List templates from MongoDB with current status
router.get('/templates', listTemplates);

// Get approved templates
router.get('/templates/approved', getApprovedTemplates);

// Get pending templates
router.get('/templates/pending', getPendingTemplates);

// Get rejected templates
router.get('/templates/rejected', getRejectedTemplates);

// Check if template name exists (for validation)
router.get('/templates/check-name', checkTemplateNameExists);

module.exports=router;