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
        }
    }
    ]
});

module.exports = mongoose.model('userResponse',userResponseSchema);