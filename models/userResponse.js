const mongoose = require('mongoose');

const userResponseSchema= new mongoose.Schema({
    googleId: {
        type: String,
        required: true,
        index: true
    },
    response:[{
        urls:{
            type: String,
            required: true
        },
        campaignId: {
            type: String,
            required: true
        },
        isTaskCompleted: {
            type: Boolean,
            default: false
        },
        views: {
            type: Number,
            default: 0
        },
        likes: {
            type: Number,
            default: 0
        },
        comments: {
            type: Number,
            default: 0
        },
        cutoff:{
            type: Number,
        },
        isCreditAccepted: {
            type: Boolean,
            default: false
        },
        creditAmount: {
            type: Number,
            default: 0
        },
        status: {
            type: String,
            default: 'pending'
        },
    }
    ]
});

module.exports = mongoose.model('userResponse',userResponseSchema);