const express=require('express');
const router=express.Router();

const {addPhoneNumber,getAllPhoneNumbers,getPhoneNumberById}=require('../../controllers/whatsapp/phonenumbercontroller');


router.post('/contacts', addPhoneNumber);
router.get('/contacts', getAllPhoneNumbers);
router.get('/contacts/:id', getPhoneNumberById);


module.exports=router;