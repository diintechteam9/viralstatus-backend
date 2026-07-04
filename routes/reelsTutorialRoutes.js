const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/reelsTutorialController');
const { authenticate, authorize } = require('../middleware/authenticate');

const clientOnly = [authenticate, authorize('client', 'admin', 'super_admin')];
const readAccess = [authenticate, authorize('client', 'admin', 'super_admin', 'mobileuser')];

// Public read (for user task detail page — no auth needed)
router.get('/',    ctrl.listTutorials);
router.get('/:id', ctrl.getTutorial);

// Client write — multipart handled inside controller
router.post('/',        ...clientOnly, ctrl.createTutorial);
router.patch('/:id',    ...clientOnly, ctrl.updateTutorial);
router.delete('/:id',   ...clientOnly, ctrl.deleteTutorial);

module.exports = router;
