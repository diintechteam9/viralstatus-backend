// routes/postRoutes.js

const express = require('express');
const router = express.Router();
const Post = require('../models/Post');

// ✅ POST route to create a new post
router.post('/', async (req, res) => {
  try {
    const newPost = new Post(req.body);
    await newPost.save();
    res.status(201).json(newPost);
  } catch (err) {
    console.error('Error creating post:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

//  GET route to fetch all posts
router.get('/', async (req, res) => {
  try {
    const posts = await Post.find();
    res.status(200).json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

//DELETE route to delete the present post while targating id
router.delete('/api/posts/:id', async (req, res) => {
  try {
    const postId = req.params.id;
    const deleted = await PostModel.findByIdAndDelete(postId);
    if (!deleted) {
      return res.status(404).json({ message: 'Post not found' });
    }
    return res.status(200).json({ message: 'Post deleted successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error deleting post' });
  }
});


module.exports = router;
