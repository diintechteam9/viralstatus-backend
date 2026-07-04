const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/ugcPrompterController');
const { authenticate, authorize } = require('../middleware/authenticate');

// Write access — only client / admin / super_admin
const clientOnly = authorize('client', 'admin', 'super_admin');

// Read access — client, admin, super_admin AND mobileuser (user dashboard)
const readAccess = authorize('client', 'admin', 'super_admin', 'mobileuser');

// AI generate (no save) — client / admin only
router.post('/generate', authenticate, clientOnly, ctrl.generatePrompt);

// READ — clients manage, mobile users read their brand's prompts
router.get('/',    authenticate, readAccess, ctrl.getPrompts);
router.get('/:id', authenticate, readAccess, ctrl.getPromptById);

// WRITE — client / admin only
router.post('/',       authenticate, clientOnly, ctrl.createPrompt);
router.patch('/:id',   authenticate, clientOnly, ctrl.updatePrompt);
router.delete('/:id',  authenticate, clientOnly, ctrl.deletePrompt);

module.exports = router;
