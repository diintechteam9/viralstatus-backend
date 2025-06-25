// models/Category.js
const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    slug: {
        type: String,
        // required: true,
        unique: true,
        lowercase: true
    },
    description: {
        type: String,
        trim: true
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Create slug from name
CategorySchema.pre('save', async function(next) {
    try {
        // Generate base slug from name
        const baseSlug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

        // If this is a subcategory, include parent's slug
        if (this.parentId) {
            const parentCategory = await this.constructor.findById(this.parentId);
            if (parentCategory) {
                this.slug = `${parentCategory.slug}/${baseSlug}`;
            } else {
                this.slug = baseSlug;
            }
        } else {
            this.slug = baseSlug;
        }
        next();
    } catch (error) {
        next(error);
    }
});

module.exports = mongoose.model('Category', CategorySchema);