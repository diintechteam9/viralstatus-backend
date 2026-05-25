const express = require('express');
const router = express.Router();
const c = require('../controllers/newsBlogController');
const { authenticate, authorize } = require('../middleware/authenticate');

router.get('/', c.getAll);

// ── MUST be before /:id routes ────────────────────────────────────────────────
router.get('/external', async (req, res) => {
  const key = process.env.NEWS_API_KEY;
  if (!key) return res.json({ success: true, articles: [] });
  try {
    const axios = require('axios');
    const r = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: 'influencer marketing OR creator economy OR UGC marketing',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 10,
        apiKey: key,
      },
      timeout: 10000,
    });
    const articles = (r.data.articles || [])
      .filter(a => a.title && a.title !== '[Removed]' && a.url)
      .map((a, i) => ({
        _id: `ext-${i}-${Date.now()}`,
        title: a.title,
        summary: a.description || '',
        content: a.content || a.description || '',
        author: a.author || a.source?.name || 'External',
        imageUrl: a.urlToImage || '',
        category: 'News',
        tags: ['influencer', 'marketing'],
        published: true,
        createdAt: a.publishedAt,
        externalUrl: a.url,
        isExternal: true,
      }));
    res.json({ success: true, articles });
  } catch (err) {
    console.error('[NewsAPI]', err.message);
    res.json({ success: true, articles: [] });
  }
});

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
