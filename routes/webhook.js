const express = require('express');
const router = express.Router();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

if (process.env.NODE_ENV === 'development') {
  console.log('✅ Webhook routes loaded');
}

// Webhook verification for Instagram
router.get('/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Instagram webhook event handler
router.post('/instagram', (req, res) => {
  res.sendStatus(200);
});

// Deauthorization callback
router.post('/instagram/deauth', (req, res) => {
  const signedRequest = req.body.signed_request;
  res.sendStatus(200);
});

// Data deletion callback
router.post('/instagram/data-deletion', (req, res) => {
  const signedRequest = req.body.signed_request;

  // Send confirmation response
  const response = {
    url: 'https://6627-2401-4900-1c5c-cc36-19dc-fa7b-f619-edc4.ngrok-free.app/deletion-confirmation', // Change if needed
    confirmation_code: 'delete_1234567890' // You can dynamically generate this
  };

  res.json(response);
});

module.exports = router;
