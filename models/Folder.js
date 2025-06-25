// models/Folder.js
const mongoose = require('mongoose');

const FolderSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    subcategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    },
}, {
    timestamps: true
});

// Create path from category and subcategory
FolderSchema.pre('save', async function(next) {
    if (this.isModified('name') || this.isModified('category') || this.isModified('subcategory')) {
        const Category = mongoose.model('Category');
        const category = await Category.findById(this.category);
        let path = category.slug;
        
        if (this.subcategory) {
            const subcategory = await Category.findById(this.subcategory);
            path += `/${subcategory.slug}`;
        }
        
        path += `/${this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        this.path = path;
    }
    next();
});

module.exports = mongoose.model('Folder', FolderSchema);