const mongoose=require ('mongoose');

const phoneNumberSchema=new mongoose.Schema({
    waID:{
        type:String,
        required:true
    },
    profilename:{
        type:String,
        required:true
    }
},{ timestamps:true });

const WhatsappPhoneNumber=mongoose.model("WhatsappPhoneNumber",phoneNumberSchema);

module.exports=WhatsappPhoneNumber;