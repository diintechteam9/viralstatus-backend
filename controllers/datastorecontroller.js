const {
    PutObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3, BUCKET_NAME } = require("../config/s3");
const Datastore = require("../models/datastore");
const Category = require("../models/category");
const Folder = require("../models/Folder");

// Get Upload URL
const getUploadUrl = async (req, res) => {
    try {
        const { 
            fileId,
            categoryId, 
            subcategoryId, 
            folderId, 
            userId, 
            fileSize, 
            mimeType,
            type,
            title,
            description
        } = req.body;

        if (!categoryId || !folderId || !userId) {
            return res.status(400).json({ 
                error: "Missing required information",
                message: "Please provide category ID, folder ID, and user ID"
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
            subcategory = await Category.findById(subcategoryId);
            if (!subcategory) {
                return res.status(404).json({
                    error: "Subcategory not found",
                    message: `Subcategory with ID "${subcategoryId}" does not exist`
                });
            }
        }

        // Find folder
        const folder = await Folder.findById(folderId);
        if (!folder) {
            return res.status(404).json({
                error: "Folder not found",
                message: `Folder with ID "${folderId}" does not exist`
            });
        }

        // Generate S3 key using IDs
        const key = `${userId}/${categoryId}/${subcategoryId ? subcategoryId + '/' : ''}${folderId}/${fileId}`;
        
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            ContentType: mimeType,
            ACL: 'private'
        });

        const url = await getSignedUrl(s3, command, { 
            expiresIn: 3600,
            signableHeaders: new Set(['host', 'content-type'])
        });
        
        // Create datastore entry
        const datastoreData = {
            type: type || 'Image',
            title: title || fileId,
            description: description || '',
            fileUrl: `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`,
            fileName: fileId,
            fileSize: fileSize || 0,
            mimeType: mimeType,
            metadata: {
                userId,
                categoryId,
                subcategoryId: subcategoryId || null,
                folderId,
                key,
                mimeType
            }
        };

        const datastore = await Datastore.create(datastoreData);

        res.json({ 
            url,
            fileId: datastore._id,
            key,
            message: "Upload URL generated successfully"
        });
    } catch (err) {
        console.error("UPLOAD URL ERROR:", err);
        res.status(500).json({ 
            error: "Failed to generate upload URL",
            message: err.message
        });
    }
};

// List Files
const listFiles = async (req, res) => {
    try {
        const { categoryId, subcategoryId, folderId, userId, type } = req.body;
        
        if (!categoryId || !folderId || !userId) {
            return res.status(400).json({ 
                error: "Missing required information",
                message: "Please provide category ID, folder ID, and user ID"
            });
        }

        const query = {
            'metadata.userId': userId,
            'metadata.categoryId': categoryId,
            'metadata.folderId': folderId
        };

        if (subcategoryId) {
            query['metadata.subcategoryId'] = subcategoryId;
        }

        // Add type filter if provided
        if (type) {
            query['type'] = type;
        }
        
        const datastoreEntries = await Datastore.find(query);
        
        if (!datastoreEntries || datastoreEntries.length === 0) {
            return res.status(200).json({ 
                files: [],
                message: "No files found in this folder"
            });
        }

        res.status(200).json({ 
            files: datastoreEntries,
            message: `Found ${datastoreEntries.length} file(s)`,
            count: datastoreEntries.length
        });
    } catch (err) {
        console.error("LIST FILES ERROR:", err);
        res.status(500).json({ 
            error: "Failed to list files",
            message: err.message
        });
    }
};

// Get Download URL
const getDownloadUrl = async (req, res) => {
    try {
        const { fileId, categoryId, subcategoryId, folderId, userId } = req.body;
        
        if (!fileId || !categoryId || !folderId || !userId) {
            return res.status(400).json({ 
                error: "Missing required information",
                message: "Please provide file ID, category ID, folder ID, and user ID"
            });
        }

        // Find the file in datastore
        const file = await Datastore.findById(fileId);
        if (!file) {
            return res.status(404).json({
                error: "File not found",
                message: "The specified file does not exist"
            });
        }

        const key = file.metadata.key;
        const command = new GetObjectCommand({ 
            Bucket: BUCKET_NAME, 
            Key: key 
        });

        const url = await getSignedUrl(s3, command, { 
            expiresIn: 3600,
            signableHeaders: new Set(['host'])
        });

        res.json({ 
            url,
            message: "Download URL generated successfully",
            expiresIn: "1 hour"
        });
    } catch (err) {
        console.error("DOWNLOAD URL ERROR:", err);
        res.status(500).json({ 
            error: "Failed to generate download URL",
            message: err.message
        });
    }
};

// Delete File
const deleteFile = async (req, res) => {
    try {
        const { fileName, categoryName, subcategoryName, folderName, userId } = req.body;
        
        if (!fileName || !categoryName || !folderName || !userId) {
            const missingFields = [];
            if (!fileName) missingFields.push('file name');
            if (!categoryName) missingFields.push('category name');
            if (!folderName) missingFields.push('folder name');
            if (!userId) missingFields.push('user ID');
            
            return res.status(400).json({ 
                error: "Missing required information",
                message: `Please provide: ${missingFields.join(', ')}`,
                details: { fileName, categoryName, folderName, userId }
            });
        }

        // Find category
        const category = await Category.findOne({ name: categoryName, parentId: null });
        if (!category) {
            return res.status(404).json({
                error: "Category not found",
                message: `Category "${categoryName}" does not exist`
            });
        }

        // Find subcategory if provided
        let subcategory = null;
        if (subcategoryName) {
            subcategory = await Category.findOne({ 
                name: subcategoryName, 
                parentId: category._id 
            });
            if (!subcategory) {
                return res.status(404).json({
                    error: "Subcategory not found",
                    message: `Subcategory "${subcategoryName}" does not exist in category "${categoryName}"`
                });
            }
        }

        // Find folder
        const folder = await Folder.findOne({ 
            name: folderName,
            category: category._id,
            subcategory: subcategory ? subcategory._id : null
        });

        if (!folder) {
            return res.status(404).json({
                error: "Folder not found",
                message: `Folder "${folderName}" does not exist in the specified category/subcategory`
            });
        }

        const key = `${userId}/${category.slug}/${subcategory ? subcategory.slug + '/' : ''}${folderName}/${fileName}`;
        
        // First delete from S3
        const command = new DeleteObjectCommand({ 
            Bucket: BUCKET_NAME, 
            Key: key 
        });

        await s3.send(command);
        
        // Then delete from MongoDB
        const deleteResult = await Datastore.findOneAndDelete({
            'metadata.userId': userId,
            'metadata.categoryId': category._id,
            'metadata.subcategoryId': subcategory ? subcategory._id : null,
            'metadata.folderId': folder._id,
            'fileName': fileName
        });

        if (!deleteResult) {
            return res.status(404).json({
                error: "File not found",
                message: "The file was not found in the database",
                details: {
                    fileName,
                    categoryName,
                    subcategoryName,
                    folderName,
                    userId
                }
            });
        }

        res.json({ 
            message: "File deleted successfully",
            details: {
                deletedFromS3: true,
                deletedFromMongoDB: true,
                fileName,
                category: {
                    id: category._id,
                    name: category.name,
                    slug: category.slug
                },
                subcategory: subcategory ? {
                    id: subcategory._id,
                    name: subcategory.name,
                    slug: subcategory.slug
                } : null,
                folder: {
                    id: folder._id,
                    name: folder.name
                }
            }
        });
    } catch (err) {
        console.error("DELETE FILE ERROR:", {
            message: err.message,
            stack: err.stack,
            name: err.name
        });
        
        let errorMessage = "Failed to delete file";
        if (err.name === 'NoSuchKey') {
            errorMessage = "File not found in storage";
        } else if (err.name === 'AccessDenied') {
            errorMessage = "Access denied to delete file";
        }
        
        res.status(500).json({ 
            error: errorMessage,
            message: "Please try again or contact support if the problem persists",
            details: err.message
        });
    }
};

module.exports = {
    getUploadUrl,
    listFiles,
    getDownloadUrl,
    deleteFile
}; 