const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/reelsTutorialController');
const { authenticate, authorize } = require('../middleware/authenticate');

const clientOnly = [authenticate, authorize('client', 'admin', 'super_admin')];
const mobileOnly = [authenticate, authorize('mobileuser')];
const clientOrMobile = [authenticate, authorize('client', 'admin', 'super_admin', 'mobileuser')];

// User — auth required
router.get('/',    ...clientOrMobile, ctrl.listTutorials);
router.get('/:id', ...clientOrMobile, ctrl.getTutorial);

// Client write
router.post('/',     ...clientOnly, ctrl.createTutorial);
router.patch('/:id', ...clientOnly, ctrl.updateTutorial);
router.delete('/:id',...clientOnly, ctrl.deleteTutorial);

module.exports = router;
