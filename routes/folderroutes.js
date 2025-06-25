const express = require('express');
const router = express.Router();
const folderController = require('../controllers/folderController');
const { protect } = require('../middleware/auth');

// Create folder
router.post('/',  folderController.createFolder);

// Get folders by category
// router.get('/category/:categoryId', protect, folderController.getFoldersByCategory);

// Get folders by category and subcategory
router.get('/category/:categoryId/subcategory/:subcategoryId', protect, folderController.getFoldersByCategory);

// Get folder by ID
router.get('/:id', protect, folderController.getFolder);

// Delete folder
router.delete('/:id', protect, folderController.deleteFolder);

module.exports = router; 
