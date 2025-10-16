const mongoose = require('mongoose');

const reelSchema = mongoose.Schema({
    poolId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pool',
        required:true
    },
    s3Key:{
        type:String
    },
    s3Url:{
        type:String
    },
    title: {
        type: String,
        default: ''
    }
},
{
    timestamps: true
});

module.exports = mongoose.model('Reel',reelSchema)