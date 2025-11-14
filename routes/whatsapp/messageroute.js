const express = require('express');
const router = express.Router();

const { saveMessage, getMessagesByWaID, getAllMessages } = require('../../controllers/whatsapp/messagecontroller');

router.post('/messages', saveMessage);
router.get('/messages/:waID', getMessagesByWaID);
router.get('/debug/all-messages', getAllMessages);

module.exports = router;