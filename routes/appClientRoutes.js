const express = require('express');
const router = express.Router();
const { appClientAuth } = require('../middleware/appClientAuth');
const ctrl = require('../controllers/appClientController');

router.use(appClientAuth);

router.get('/', ctrl.getAllAppClients);
router.post('/', ctrl.uploadLogo.single('businessLogo'), ctrl.createAppClient);
router.put('/:id', ctrl.uploadLogo.single('businessLogo'), ctrl.updateAppClient);
router.delete('/:id', ctrl.deleteAppClient);

module.exports = router;
