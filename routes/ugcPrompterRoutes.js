const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/ugcPrompterController');
const videoCtrl = require('../controllers/ugcVideoController');
const { authenticate, authorize } = require('../middleware/authenticate');

const clientOnly = authorize('client', 'admin', 'super_admin');
const mobileOnly = authorize('mobileuser');
const allRoles = authorize('client', 'admin', 'super_admin', 'mobileuser');

// AI generation - client only (expensive API)
router.post('/generate', authenticate, clientOnly, ctrl.generatePrompt);

// Public script view for users (mobileuser)
router.get('/public/:promptId', authenticate, mobileOnly, videoCtrl.getPromptForUser);

// Get prompts - client and mobileuser
router.get('/', authenticate, allRoles, ctrl.getPrompts);
router.get('/:id', authenticate, allRoles, ctrl.getPromptById);

// Create/Update/Delete - client only
router.post('/', authenticate, clientOnly, ctrl.createPrompt);
router.patch('/:id', authenticate, clientOnly, ctrl.updatePrompt);
router.delete('/:id', authenticate, clientOnly, ctrl.deletePrompt);

module.exports = router;
