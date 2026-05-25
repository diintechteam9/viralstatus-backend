const mongoose = require('mongoose');
const NewsBlog = require('../models/NewsBlog');
const NewsBlogComment = require('../models/NewsBlogComment');
const multer = require('multer');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, getobject } = require('../utils/r2');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith('image/') || file.mimetype?.startsWith('video/')) {
      return cb(null, true);
    }
    cb(new Error('Only image and video files are allowed'));
  },
});

function syncPrimaryImage(postData) {
  const media = Array.isArray(postData.media) ? postData.media : [];
  const firstImage = media.find((m) => m.type === 'image' && m.url);
  if (firstImage?.url) postData.imageUrl = firstImage.url;
  else if (!postData.imageUrl && media[0]?.url && media[0].type === 'image') {
    postData.imageUrl = media[0].url;
  }
  return postData;
}

async function storeCoverBuffer(buffer, mimetype, originalName = 'cover') {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    const mime = mimetype || 'image/jpeg';
    return {
      imageUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      storage: 'inline',
    };
  }

  const safeName = String(originalName).replace(/[^\w.-]+/g, '_').slice(0, 80);
  const ext = mimetype === 'image/png' ? 'png' : mimetype === 'image/webp' ? 'webp' : 'jpg';
  const key = `news-blog/covers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}.${ext}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimetype || 'image/jpeg',
    })
  );

  const imageUrl = await getobject(key);
  return { imageUrl, key, storage: 'r2' };
}

async function storeMediaBuffer(buffer, mimetype, originalName = 'media') {
  const bucket = process.env.R2_BUCKET;
  const isVideo = mimetype?.startsWith('video/');
  const type = isVideo ? 'video' : 'image';

  if (!bucket) {
    if (isVideo) {
      throw new Error('Video upload requires R2 storage (R2_BUCKET)');
    }
    const mime = mimetype || 'image/jpeg';
    return {
      url: `data:${mime};base64,${buffer.toString('base64')}`,
      type,
      storage: 'inline',
    };
  }

  const safeName = String(originalName).replace(/[^\w.-]+/g, '_').slice(0, 80);
  let ext = 'jpg';
  if (mimetype === 'image/png') ext = 'png';
  else if (mimetype === 'image/webp') ext = 'webp';
  else if (mimetype === 'image/gif') ext = 'gif';
  else if (mimetype === 'video/mp4') ext = 'mp4';
  else if (mimetype === 'video/webm') ext = 'webm';
  else if (isVideo) ext = 'mp4';

  const folder = isVideo ? 'news-blog/videos' : 'news-blog/media';
  const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}.${ext}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimetype || (isVideo ? 'video/mp4' : 'image/jpeg'),
    })
  );

  const url = await getobject(key);
  return { url, type, key, storage: 'r2' };
}

async function attachCommentCounts(posts) {
  if (!posts.length) return posts;
  const ids = posts.map((p) => p._id);
  const counts = await NewsBlogComment.aggregate([
    { $match: { postId: { $in: ids } } },
    { $group: { _id: '$postId', count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  return posts.map((p) => ({
    ...p,
    commentsCount: map[String(p._id)] || 0,
  }));
}

exports.getAll = async (req, res) => {
  try {
    const filter = {};
    if (req.query.published === 'true') filter.published = true;
    if (req.query.category && req.query.category !== 'All') filter.category = req.query.category;
    let posts = await NewsBlog.find(filter).sort({ createdAt: -1 }).lean();
    posts = await attachCommentCounts(posts);
    res.json({ success: true, posts });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getOne = async (req, res) => {
  try {
    const post = await NewsBlog.findById(req.params.id).lean();
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    const commentsCount = await NewsBlogComment.countDocuments({ postId: post._id });
    res.json({ success: true, post: { ...post, commentsCount } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getComments = async (req, res) => {
  try {
    const postId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: 'Invalid post id' });
    }
    const comments = await NewsBlogComment.find({ postId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const { authorName, text, visitorId } = req.body;
    if (!authorName?.trim() || !text?.trim()) {
      return res.status(400).json({ success: false, message: 'Name and comment required' });
    }
    const post = await NewsBlog.findById(req.params.id);
    if (!post || !post.published) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    const comment = await NewsBlogComment.create({
      postId: post._id,
      authorName: authorName.trim().slice(0, 80),
      text: text.trim().slice(0, 2000),
      visitorId: visitorId || '',
    });
    const commentsCount = await NewsBlogComment.countDocuments({ postId: post._id });
    res.json({ success: true, comment, commentsCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const { visitorId } = req.body;
    if (!visitorId) {
      return res.status(400).json({ success: false, message: 'visitorId required' });
    }
    const post = await NewsBlog.findById(req.params.id);
    if (!post || !post.published) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    const liked = post.likedBy.includes(visitorId);
    if (liked) {
      post.likedBy = post.likedBy.filter((id) => id !== visitorId);
      post.likesCount = Math.max(0, (post.likesCount || 0) - 1);
    } else {
      post.likedBy.push(visitorId);
      post.likesCount = (post.likesCount || 0) + 1;
    }
    await post.save();
    res.json({
      success: true,
      liked: !liked,
      likesCount: post.likesCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.recordShare = async (req, res) => {
  try {
    const post = await NewsBlog.findByIdAndUpdate(
      req.params.id,
      { $inc: { shareCount: 1 } },
      { new: true }
    );
    if (!post || !post.published) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    res.json({ success: true, shareCount: post.shareCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.togglePublish = async (req, res) => {
  try {
    const post = await NewsBlog.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    post.published = req.body.published !== undefined ? !!req.body.published : !post.published;
    await post.save();
    res.json({ success: true, post: post.toObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { title, category, summary, content, author, tags, imageUrl, media, published } = req.body;
    if (!title || !content) return res.status(400).json({ success: false, message: 'Title and content required' });
    const payload = syncPrimaryImage({
      title,
      category,
      summary,
      content,
      author,
      tags,
      imageUrl,
      media: Array.isArray(media) ? media : [],
      published,
    });
    const post = await NewsBlog.create(payload);
    res.json({ success: true, post });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.media !== undefined || body.imageUrl !== undefined) {
      syncPrimaryImage(body);
    }
    const post = await NewsBlog.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, post });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.remove = async (req, res) => {
  try {
    await NewsBlog.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

/** POST multipart field: files[] — images & videos */
exports.uploadMedia = [
  mediaUpload.array('files', 15),
  async (req, res) => {
    try {
      if (!req.files?.length) {
        return res.status(400).json({ success: false, message: 'At least one file required' });
      }
      const media = [];
      for (const file of req.files) {
        const result = await storeMediaBuffer(
          file.buffer,
          file.mimetype,
          file.originalname
        );
        media.push({
          type: result.type,
          url: result.url,
          caption: '',
        });
      }
      res.json({ success: true, media });
    } catch (err) {
      console.error('[NewsBlog] uploadMedia:', err.message);
      res.status(500).json({ success: false, message: err.message || 'Upload failed' });
    }
  },
];

/** POST multipart field: image */
exports.uploadCover = [
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Image file required' });
      }
      const result = await storeCoverBuffer(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('[NewsBlog] uploadCover:', err.message);
      res.status(500).json({ success: false, message: err.message || 'Upload failed' });
    }
  },
];

/** POST JSON { imageData: "data:image/...;base64,..." } — e.g. AI-generated cover */
exports.uploadCoverBase64 = async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData || typeof imageData !== 'string') {
      return res.status(400).json({ success: false, message: 'imageData required' });
    }
    const match = imageData.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Invalid base64 image data' });
    }
    const mimetype = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length < 100) {
      return res.status(400).json({ success: false, message: 'Image data too small' });
    }
    const result = await storeCoverBuffer(buffer, mimetype, 'ai-cover');
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[NewsBlog] uploadCoverBase64:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Upload failed' });
  }
};
