const mongoose = require('mongoose');

const imageSchema = mongoose.Schema({
    imagePoolId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ImagePool',
        required: true
    },
    s3Key: {
        type: String
    },
    s3Url: {
        type: String
    },
    title: {
        type: String,
        default: ''
    }
},
{
    timestamps: true
});

module.exports = mongoose.model('Image', imageSchema);
