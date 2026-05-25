const express = require('express');
const router = express.Router();
const c = require('../controllers/newsBlogController');
const { authenticate, authorize } = require('../middleware/authenticate');

router.get('/', c.getAll);
router.post('/upload-cover', authenticate, authorize('admin', 'super_admin'), c.uploadCover);
router.post('/upload-cover-base64', authenticate, authorize('admin', 'super_admin'), c.uploadCoverBase64);
router.post('/upload-media', authenticate, authorize('admin', 'super_admin'), c.uploadMedia);
router.post('/', authenticate, authorize('admin', 'super_admin'), c.create);

router.get('/:id/comments', c.getComments);
router.post('/:id/comment', c.addComment);
router.post('/:id/like', c.toggleLike);
router.post('/:id/share', c.recordShare);
router.patch('/:id/publish', authenticate, authorize('admin', 'super_admin'), c.togglePublish);

router.get('/:id', c.getOne);
router.put('/:id', authenticate, authorize('admin', 'super_admin'), c.update);
router.delete('/:id', authenticate, authorize('admin', 'super_admin'), c.remove);

module.exports = router;
