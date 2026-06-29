const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reelsTutorialController');

router.get('/', ctrl.listTutorials);
router.post('/', ctrl.createTutorial);
router.put('/:id', ctrl.updateTutorial);
router.delete('/:id', ctrl.deleteTutorial);

module.exports = router;
