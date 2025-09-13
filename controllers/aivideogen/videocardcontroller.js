const video=require('../../models/aivideogen');

const videocard=async(req,res)=>{
    try {
        const videocard=new video(req.body);
        await videocard.save();
        res.status(201).json(videocard);
    } catch (err) {
        res.status(400).json({error:err.message});
    }
};


const getallvideocard=async(req,res)=>{
try {
    const all=await video.find();
    res.json(all);
} catch (err) {
    res.status(500).json({error:err.message});
    }
};

const getallvideocardById=async(req,res)=>{
    try {
        const id=await video.findById(req.params.id);
        if(!id) return res.status(404).json({error:'Video not found'});
        res.json(id);
    } catch (err) {
        res.status(500).json({error:err.message});
    }
};


const updatevideocard=async(req,res)=>{
    try {
        const videocard=await video.findByIdAndUpdate(req.params.id,req.body,{new:true});
        if(!videocard) return res.status(404).json({error:'Video not found'});
        res.json(videocard);
    } catch (err) {
        res.status(500).json({error:err.message});
    }
};


const deletevideocard=async(req,res)=>{
    try {
        const videocard=await video.findByIdAndDelete(req.params.id);
        if(!videocard) return res.status(404).json({error:'Video not found'});
        res.json({message:"deleted successfully"});
        
    } catch (err) {
        res.status(500).json({error:err.message});
        
    }
};


module.exports={videocard,getallvideocard,getallvideocardById,updatevideocard,deletevideocard};