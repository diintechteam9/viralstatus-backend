const PhoneNumber=require('../../models/whatsapp/phonenumber');

const addPhoneNumber=async(req,res)=>{
    try{
        const { waID, profilename } = req.body;
        if(!waID || !profilename){
            return res.status(400).json({error:'waID and profilename are required'});
        }
        const created = await PhoneNumber.create({ waID, profilename });
        res.status(201).json(created);
    }
    catch(err){
        res.status(400).json({error:err.message});
    }
};


const getAllPhoneNumbers=async(req,res)=>{
    try {
        const all=await PhoneNumber.find();
        res.json(all);
    } catch (err) {
        res.status(500).json({error:err.message});       
    }
};

const getPhoneNumberById=async(req,res)=>{
    try {
        const doc=await PhoneNumber.findById(req.params.id);
        if(!doc) return res.status(404).json({error:'Not found'});
        res.json(doc);
    } catch (err) {
        res.status(500).json({error:err.message});
    }
};

module.exports={addPhoneNumber,getAllPhoneNumbers,getPhoneNumberById};