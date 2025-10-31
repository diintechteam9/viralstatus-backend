const express = require('express');
const router = express.Router();
const imagePoolController = require('../controllers/imagePoolController');
const imageController = require('../controllers/imageController');

//-----------Images controls-----------
//upload image 
router.post('/:imagePoolId/upload', imageController.uploadImages);

// RESTful route for fetching images by imagePoolId
router.get('/:imagePoolId/images', imageController.getImagesByImagePoolId);

// Delete a single image
router.delete('/images/:imageId', imageController.deleteImage);

// Delete multiple images
router.delete('/images', imageController.deleteMultipleImages);

// Delete all images from an image pool
router.delete('/:imagePoolId/images', imageController.deleteAllImagesFromPool);

// ------------image pool controls--------------

// Create a new image pool
router.post('/', imagePoolController.createImagePool);

// Get all image pools
router.get('/', imagePoolController.getImagePools);

// Get image pool by id (must come before /:id to avoid conflicts)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const imagePool = await require('../models/imagepool').findById(id);
    if (!imagePool) {
      return res.status(404).json({ error: 'Image pool not found' });
    }
    res.json({ imagePool });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch image pool', details: err.message });
  }
});

// Update image pool by id
router.put('/:id', imagePoolController.updateImagePool);

// Delete image pool by id
router.delete('/:id', imagePoolController.deleteImagePool);


module.exports = router;
