const mongoose = require("mongoose");

const datastoreSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['Image', 'Video', 'Audio']
    },
    
    title: {
        type: String,
        // required: false,
        trim: true,
    },
    description: {
        type: String,
        // required: false,
        trim: true,
        default: ''
    },
    fileUrl: {
        type: String,
        required: true,
    },
    fileName: {
        type: String,
        required: true,
    },
    fileSize: {
        type: Number,
        required: true,
    },
    mimeType: {
        type: String,
        required: true,
    },
    metadata: {
        userId: String,
        categoryId:String,
        subcategoryId:String,
        folderId:String,
        folderName: String,
        key: String,
        mimeType: String
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

const Datastore = mongoose.model("Datastore", datastoreSchema);

module.exports = Datastore;
