const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/ugcPrompterController');
const { authenticate, authorize } = require('../middleware/authenticate');

const allAccess = authorize('client', 'admin', 'super_admin', 'mobileuser');

router.post('/generate', authenticate, allAccess, ctrl.generatePrompt);

router.get('/',    authenticate, allAccess, ctrl.getPrompts);
router.get('/:id', authenticate, allAccess, ctrl.getPromptById);

router.post('/',       authenticate, allAccess, ctrl.createPrompt);
router.patch('/:id',   authenticate, allAccess, ctrl.updatePrompt);
router.delete('/:id',  authenticate, allAccess, ctrl.deletePrompt);

module.exports = router;
