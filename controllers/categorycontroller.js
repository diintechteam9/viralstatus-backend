// controllers/categoryController.js
const Category = require('../models/category');
const Folder = require('../models/Folder');

// Create Category
const createCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({
                error: "Missing required fields",
                message: "Category name is required"
            });
        }

        // Create category
        const category = await Category.create({
            name,
            description
        });

        res.status(201).json({
            message: "Category created successfully",
            category
        });
    } catch (err) {
        console.log(err)
        console.error("CREATE CATEGORY ERROR:", err);
        res.status(500).json({
            error: "Failed to create category",
            message: err.message
        });
    }
};

// Create Subcategory
const createSubcategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { name, description } = req.body;

        // Validate required fields
        if (!name) {
            return res.status(400).json({
                error: "Missing required fields",
                message: "Subcategory name is required"
            });
        }

        // Check if parent category exists
        const parentCategory = await Category.findById(categoryId);
        if (!parentCategory) {
            return res.status(404).json({
                error: "Parent category not found",
                message: "The specified parent category does not exist"
            });
        }

        // Create subcategory
        const subcategory = await Category.create({
            name,
            description,
            parentId: categoryId
        });

        res.status(201).json({
            message: "Subcategory created successfully",
            subcategory
        });
    } catch (err) {
        console.error("CREATE SUBCATEGORY ERROR:", err);
        res.status(500).json({
            error: "Failed to create subcategory",
            message: err.message
        });
    }
};

// Get All Categories
const getAllCategories = async (req, res) => {
    try {
        // Get only main categories (no parentId)
        const categories = await Category.find({ parentId: null, isActive: true })
            .sort({ name: 1 });

        res.json({
            categories
        });
    } catch (err) {
        console.log(err)
        console.error("GET CATEGORIES ERROR:", err);
        res.status(500).json({
            error: "Failed to fetch categories",
            message: err.message
        });
    }
};

// Get Subcategories
const getSubcategories = async (req, res) => {
    try {
        const { categoryId } = req.params;

        // Get subcategories for the specified category
        const subcategories = await Category.find({
            parentId: categoryId,
            isActive: true
        }).sort({ name: 1 });

        res.json({
            subcategories
        });
    } catch (err) {
        console.error("GET SUBCATEGORIES ERROR:", err);
        res.status(500).json({
            error: "Failed to fetch subcategories",
            message: err.message
        });
    }
};

// Update Category
const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        const category = await Category.findById(id);
        if (!category) {
            return res.status(404).json({
                error: "Category not found",
                message: "The specified category does not exist"
            });
        }

        // Update category
        if (name) category.name = name;
        if (description !== undefined) category.description = description;

        await category.save();

        res.json({
            message: "Category updated successfully",
            category
        });
    } catch (err) {
        console.error("UPDATE CATEGORY ERROR:", err);
        res.status(500).json({
            error: "Failed to update category",
            message: err.message
        });
    }
};

// Update Subcategory
const updateSubcategory = async (req, res) => {
    try {
        const { categoryId, subcategoryId } = req.params;
        const { name, description } = req.body;

        const subcategory = await Category.findOne({
            _id: subcategoryId,
            parentId: categoryId
        });

        if (!subcategory) {
            return res.status(404).json({
                error: "Subcategory not found",
                message: "The specified subcategory does not exist"
            });
        }

        // Update subcategory
        if (name) subcategory.name = name;
        if (description !== undefined) subcategory.description = description;

        await subcategory.save();

        res.json({
            message: "Subcategory updated successfully",
            subcategory
        });
    } catch (err) {
        console.error("UPDATE SUBCATEGORY ERROR:", err);
        res.status(500).json({
            error: "Failed to update subcategory",
            message: err.message
        });
    }
};

// Delete Category
const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if category exists
        const category = await Category.findById(id);
        if (!category) {
            return res.status(404).json({
                error: "Category not found",
                message: "The specified category does not exist"
            });
        }

        // Check if category has subcategories
        const hasSubcategories = await Category.exists({ parentId: id });
        if (hasSubcategories) {
            return res.status(400).json({
                error: "Cannot delete category",
                message: "This category has subcategories. Please delete subcategories first."
            });
        }

        // Check if category has folders
        const hasFolders = await Folder.exists({ category: id });
        if (hasFolders) {
            return res.status(400).json({
                error: "Cannot delete category",
                message: "This category contains folders. Please delete or move folders first."
            });
        }

        // Delete category
        await category.deleteOne();

        res.json({
            message: "Category deleted successfully"
        });
    } catch (err) {
        console.error("DELETE CATEGORY ERROR:", err);
        res.status(500).json({
            error: "Failed to delete category",
            message: err.message
        });
    }
};

// Delete Subcategory
const deleteSubcategory = async (req, res) => {
    try {
        const { categoryId, subcategoryId } = req.params;

        // Check if subcategory exists and belongs to the specified category
        const subcategory = await Category.findOne({
            _id: subcategoryId,
            parentId: categoryId
        });

        if (!subcategory) {
            return res.status(404).json({
                error: "Subcategory not found",
                message: "The specified subcategory does not exist"
            });
        }

        // Check if subcategory has folders
        const hasFolders = await Folder.exists({ subcategory: subcategoryId });
        if (hasFolders) {
            return res.status(400).json({
                error: "Cannot delete subcategory",
                message: "This subcategory contains folders. Please delete or move folders first."
            });
        }

        // Delete subcategory
        await subcategory.deleteOne();

        res.json({
            message: "Subcategory deleted successfully"
        });
    } catch (err) {
        console.error("DELETE SUBCATEGORY ERROR:", err);
        res.status(500).json({
            error: "Failed to delete subcategory",
            message: err.message
        });
    }
};

module.exports = {
    createCategory,
    createSubcategory,
    getAllCategories,
    getSubcategories,
    updateCategory,
    updateSubcategory,
    deleteCategory,
    deleteSubcategory
};