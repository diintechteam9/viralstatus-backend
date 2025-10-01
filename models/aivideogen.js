const mongoose=require('mongoose');

const videoSchema=new mongoose.Schema({
    // Owner client for scoping cards per client
    clientId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: true,
        index: true
    },
    name:{
        type:String,
        required:true,
    },
    description:{
        type:String,
        required:true,
    },
    category:{
        type:String,
        required:true,
    },
    // Latest generated video metadata (optional)
    latestVideoS3Key: {
        type: String,
        default: null
    },
    latestVideoUrl: {
        type: String,
        default: null
    },
    latestVideoFileName: {
        type: String,
        default: null
    },
    latestVideoFileSize: {
        type: Number,
        default: null
    },
    latestVideoDuration: {
        type: Number,
        default: null
    },
    latestVideoCreatedAt: {
        type: Date,
        default: null
    },
    createdAt:{
        type:Date,
        default:Date.now
    },
    updatedAt:{
        type:Date,
        default:Date.now
    }
});

module.exports=mongoose.model('video',videoSchema);
