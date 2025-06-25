const Folder = require('../models/Folder');
const Category = require('../models/category');
const Datastore = require('../models/datastore');

// Create folder
const createFolder = async (req, res) => {
    try {
        const { name, categoryId, subcategoryId } = req.body;
        
        if (!name || !categoryId) {
            return res.status(400).json({ 
                error: "Missing required fields",
                message: "Please provide folder name and category ID"
            });
        }

        // Find category
        const category = await Category.findById(categoryId);
        if (!category) {
            return res.status(404).json({
                error: "Category not found",
                message: `Category with ID "${categoryId}" does not exist`
            });
        }

        // Find subcategory if provided
        let subcategory = null;
        if (subcategoryId) {
            subcategory = await Category.findOne({ 
                _id: subcategoryId,
                parentId: categoryId
            });
            if (!subcategory) {
                return res.status(404).json({
                    error: "Subcategory not found",
                    message: `Subcategory with ID "${subcategoryId}" does not exist in the specified category`
                });
            }
        }

        // Check if folder already exists
        const existingFolder = await Folder.findOne({
            name,
            category: categoryId,
            subcategory: subcategoryId || null
        });

        if (existingFolder) {
            return res.status(400).json({
                error: "Folder already exists",
                message: `A folder with this name already exists in the specified category/subcategory`,
                folder: {
                    id: existingFolder._id,
                    name: existingFolder.name,
                    categoryId: category._id,
                    subcategoryId: subcategory ? subcategory._id : null,
                    category: category.name,
                    subCategory: subcategory ? subcategory.name : null
                }
            });
        }

        const folder = await Folder.create({
            name,
            category: categoryId,
            subcategory: subcategoryId || null
        });

        res.status(201).json({
            message: "Folder created successfully",
            folder: {
                id: folder._id,
                name: folder.name,
                categoryId: category._id,
                subcategoryId: subcategory ? subcategory._id : null,
                category: category.name,
                subCategory: subcategory ? subcategory.name : null,
                createdAt: folder.createdAt
            }
        });
    } catch (error) {
        console.error("CREATE FOLDER ERROR:", error);
        res.status(500).json({ 
            error: "Failed to create folder",
            message: error.message
        });
    }
};

// Get folders by category
const getFoldersByCategory = async (req, res) => {
    try {
        const { categoryId, subcategoryId } = req.params;
        
        // Find category
        const category = await Category.findById(categoryId);
        if (!category) {
            return res.status(404).json({
                error: "Category not found",
                message: `Category with ID "${categoryId}" does not exist`
            });
        }

        // Find subcategory if provided
        let subcategory = null;
        if (subcategoryId) {
            subcategory = await Category.findById(subcategoryId);
            if (!subcategory) {
                return res.status(404).json({
                    error: "Subcategory not found",
                    message: `Subcategory with ID "${subcategoryId}" does not exist`
                });
            }
        }

        const query = { category: category._id };
        if (subcategory) {
            query.subcategory = subcategory._id;
        }

        const folders = await Folder.find(query)
            .populate('category', 'name')
            .populate('subcategory', 'name');

        res.json({
            folders: folders.map(folder => ({
                _id: folder._id,
                name: folder.name,
                categoryId: folder.category._id,
                subcategoryId: folder.subcategory ? folder.subcategory._id : null,
                category: folder.category.name,
                subCategory: folder.subcategory ? folder.subcategory.name : null,
                createdAt: folder.createdAt
            }))
        });
    } catch (error) {
        console.error("GET FOLDERS ERROR:", error);
        res.status(500).json({ 
            error: "Failed to fetch folders",
            message: error.message
        });
    }
};

// Get folder by ID
const getFolder = async (req, res) => {
    try {
        const folder = await Folder.findById(req.params.id)
            .populate('category', 'name slug')
            .populate('subcategory', 'name slug');

        if (!folder) {
            return res.status(404).json({ 
                error: "Folder not found",
                message: "The specified folder does not exist"
            });
        }

        res.json({
            folder: {
                id: folder._id,
                name: folder.name,
                category: {
                    id: folder.category._id,
                    name: folder.category.name,
                    slug: folder.category.slug
                },
                subcategory: folder.subcategory ? {
                    id: folder.subcategory._id,
                    name: folder.subcategory.name,
                    slug: folder.subcategory.slug
                } : null
            }
        });
    } catch (error) {
        console.error("GET FOLDER ERROR:", error);
        res.status(500).json({ 
            error: "Failed to fetch folder",
            message: error.message
        });
    }
};

// Delete folder
const deleteFolder = async (req, res) => {
    try {
        const folder = await Folder.findById(req.params.id);
        
        if (!folder) {
            return res.status(404).json({ 
                error: "Folder not found",
                message: "The specified folder does not exist"
            });
        }

        // Check if folder has files
        const hasFiles = await Datastore.exists({ 'metadata.folderId': folder._id });
        if (hasFiles) {
            return res.status(400).json({ 
                error: "Cannot delete folder",
                message: "This folder contains files. Please delete files first."
            });
        }

        await folder.remove();
        res.json({ 
            message: "Folder deleted successfully",
            folder: {
                id: folder._id,
                name: folder.name
            }
        });
    } catch (error) {
        console.error("DELETE FOLDER ERROR:", error);
        res.status(500).json({ 
            error: "Failed to delete folder",
            message: error.message
        });
    }
};

module.exports = {
    createFolder,
    getFoldersByCategory,
    getFolder,
    deleteFolder
}; 