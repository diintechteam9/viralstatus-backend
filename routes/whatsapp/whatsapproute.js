const express = require('express');
const router = express.Router();
const { testWebhook, verifyWebhook, receiveMessage } = require('../../controllers/whatsapp/whatsappwebhookcontroller');
const { sendTextMessage, sendMediaMessage, getMessageStatus, sendInteractiveMessage } = require('../../controllers/whatsapp/whatsappchatcontroller');

// Webhook routes for WhatsApp
router.get('/webhook', verifyWebhook);   // this is working 
router.post('/webhook', receiveMessage);


router.get('/webhook/test', testWebhook); // this is working 

// Chat routes for sending messages
router.post('/send-message', sendTextMessage);
router.post('/send-media', sendMediaMessage);
router.post('/send-interactive', sendInteractiveMessage);
router.get('/message-status/:messageId', getMessageStatus);


// // Route to test different WhatsApp API formats
// router.post('/test-api', testWhatsAppAPI);

// // Route to get message status (optional)
// router.get('/message-status/:messageId', getMessageStatus);


module.exports = router;