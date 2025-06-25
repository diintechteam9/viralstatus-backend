// routes/categoryRoutes.js
const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categorycontroller');
const { protect } = require('../middleware/auth');

// Create category
router.post('/', protect, categoryController.createCategory);

// Create subcategory
router.post('/:categoryId/subcategories', protect, categoryController.createSubcategory);

// Get all categories
router.get('/', protect, categoryController.getAllCategories);

// Get subcategories
router.get('/:categoryId/subcategories', protect, categoryController.getSubcategories);

// Update category
router.put('/:id', protect, categoryController.updateCategory);

// Update subcategory
router.put('/:categoryId/subcategories/:subcategoryId', protect, categoryController.updateSubcategory);

// Delete category
router.delete('/:id', protect, categoryController.deleteCategory);

// Delete subcategory
router.delete('/:categoryId/subcategories/:subcategoryId', protect, categoryController.deleteSubcategory);

module.exports = router;