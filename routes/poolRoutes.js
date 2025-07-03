const express = require('express');
const router = express.Router();
const poolController = require('../controllers/poolController');


// Create a new pool
router.post('/', poolController.createPool);

// Get all pools
router.get('/', poolController.getPools);

module.exports = router; 