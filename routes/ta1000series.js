const express = require('express');
const router = express.Router();
const controller = require('../controllers/ta1000seriescontroller');

router.post('/reelta1000series', controller.createTA1000Series);
router.get('/reelta1000series', controller.getAllTA1000Series);
router.get('/:id', controller.getTA1000SeriesById);
router.put('/:id', controller.updateTA1000Series);
router.delete('/:id', controller.deleteTA1000Series);

module.exports = router; 