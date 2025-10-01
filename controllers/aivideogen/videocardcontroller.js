const video=require('../../models/aivideogen');

const videocard=async(req,res)=>{
    try {
        // require client auth
        const clientId = req.client?.id || req.user?.id; // fallback if using user as client
        if(!clientId){
            return res.status(401).json({ error: 'Not authorized' });
        }
        const payload = { ...req.body, clientId };
        const videocard=new video(payload);
        await videocard.save();
        res.status(201).json(videocard);
    } catch (err) {
        res.status(400).json({error:err.message});
    }
};


const getallvideocard=async(req,res)=>{
try {
    const clientId = req.client?.id || req.user?.id;
    if(!clientId){
        return res.status(401).json({ error: 'Not authorized' });
    }
    const all=await video.find({ clientId });
    res.json(all);
} catch (err) {
    res.status(500).json({error:err.message});
    }
};

const getallvideocardById=async(req,res)=>{
    try {
        const clientId = req.client?.id || req.user?.id;
        if(!clientId){
            return res.status(401).json({ error: 'Not authorized' });
        }
        const id=await video.findOne({ _id: req.params.id, clientId });
        if(!id) return res.status(404).json({error:'Video not found'});
        res.json(id);
    } catch (err) {
        res.status(500).json({error:err.message});
    }
};


const updatevideocard=async(req,res)=>{
    try {
        const clientId = req.client?.id || req.user?.id;
        if(!clientId){
            return res.status(401).json({ error: 'Not authorized' });
        }
        const update = { ...req.body };
        // prevent clientId change
        delete update.clientId;
        const videocard=await video.findOneAndUpdate({ _id: req.params.id, clientId }, update, { new:true });
        if(!videocard) return res.status(404).json({error:'Video not found'});
        res.json(videocard);
    } catch (err) {
        res.status(500).json({error:err.message});
    }
};


const deletevideocard=async(req,res)=>{
    try {
        const clientId = req.client?.id || req.user?.id;
        if(!clientId){
            return res.status(401).json({ error: 'Not authorized' });
        }
        const videocard=await video.findOneAndDelete({ _id: req.params.id, clientId });
        if(!videocard) return res.status(404).json({error:'Video not found'});
        res.json({message:"deleted successfully"});
        
    } catch (err) {
        res.status(500).json({error:err.message});
        
    }
};


module.exports={videocard,getallvideocard,getallvideocardById,updatevideocard,deletevideocard};