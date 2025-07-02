const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');

// Join a group (auto-create if needed)
router.post('/join', groupController.joinGroup);

// Get all groups
router.get('/', groupController.getAllGroups);

// Get groups by interest
router.get('/interest/:interest', groupController.getGroupsByInterest);

// Get groups for a user
router.get('/user/:email', groupController.getGroupsForUser);

module.exports = router; 