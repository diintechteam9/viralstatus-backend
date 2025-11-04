const express = require('express');
const {
  getAllCards,
  getCard,
  createCard,
  updateCard,
  deleteCard,
  deleteAllCards,
  getCardStats
} = require('../../controllers/leadcapture/cardController');

const router = express.Router();

// Routes
router.get('/', getAllCards);
router.get('/stats', getCardStats);
router.post('/', createCard);
router.delete('/delete-all', deleteAllCards);
router.get('/:cardId', getCard);
router.put('/:cardId', updateCard);
router.delete('/:cardId', deleteCard);

module.exports = router;
