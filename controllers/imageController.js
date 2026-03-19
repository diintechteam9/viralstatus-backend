const busboy = require('busboy');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, getobject, deleteObject } = require('../utils/r2');
const Image = require('../models/Image');
const ImagePool = require('../models/imagePool');

exports.uploadImages = async (req, res) => {
  const bb = busboy({ headers: req.headers });
  const { imagePoolId } = req.params; // Get imagePoolId from URL params
  const images = [];
  let fileUploadPromises = [];

  // Fetch image pool name using imagePoolId
  let poolName = 'pool';
  try {
    const imagePool = await ImagePool.findById(imagePoolId);
    if (imagePool && imagePool.name) {
      poolName = imagePool.name.replace(/\s+/g, '_'); // Replace spaces with underscores
    }
  } catch (err) {
    console.error('Error fetching image pool for pool name:', err);
  }

  // Count existing images for this image pool to determine the next image number
  let imageCount = 0;
  try {
    imageCount = await Image.countDocuments({ imagePoolId });
  } catch (err) {
    console.error('Error counting images for image pool:', err);
  }

  let imageNumber = imageCount + 1;

  bb.on('file', (fieldname, file, filename, encoding, mimetype) => {
    const currentImageNumber = imageNumber++; // Assign and increment immediately for each file
    // Buffer the file chunks in memory
    const chunks = [];
    file.on('data', (chunk) => {
      chunks.push(chunk);
    });
    file.on('end', async () => {
      const fileBuffer = Buffer.concat(chunks);
      // Ensure filename is a string
      if (typeof filename !== 'string' || !filename) {
        filename = `${poolName}_image${currentImageNumber}.jpg`;
      } else {
        // Replace original filename with poolName_image{n}.jpg
        const ext = filename.split('.').pop() || 'jpg';
        filename = `${poolName}_image${currentImageNumber}.${ext}`;
      }
      const s3Key = `${imagePoolId}/images/${filename}`;
      const uploadPromise = s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mimetype || 'image/jpeg',
        ContentLength: fileBuffer.length,
      }))
        .then(async () => {
          // Generate pre-signed GET URL for access
          const s3Url = await getobject(s3Key);
          // Save to DB
          const imageDoc = await Image.create({
            imagePoolId,
            s3Key,
            s3Url,
            title: `${poolName} Image ${currentImageNumber}`
          });
          images.push(imageDoc);
        })
        .catch(err => {
          console.error('Error uploading file:', err);
        });

      fileUploadPromises.push(uploadPromise);
    });
  });

  bb.on('finish', async () => {
    await Promise.all(fileUploadPromises);
    // Optionally update imageCount in ImagePool
    if (imagePoolId) {
      await ImagePool.findByIdAndUpdate(
        imagePoolId,
        { $inc: { imageCount: images.length } }
      );
    }
    res.json({ success: true, images });
  });

  req.pipe(bb);
};

exports.getImagesByImagePoolId = async (req, res) => {
  const { imagePoolId } = req.params;
  if (!imagePoolId) {
    return res.status(400).json({ success: false, error: "imagePoolId is required" });
  }
  try {
    const images = await Image.find({ imagePoolId });
    
    // Generate fresh S3 URLs for each image to prevent expiration
    const imagesWithFreshUrls = await Promise.all(
      images.map(async (image) => {
        try {
          // Generate a fresh pre-signed URL for each image
          const freshUrl = await getobject(image.s3Key);
          return {
            ...image.toObject(),
            s3Url: freshUrl
          };
        } catch (urlError) {
          console.error(`Error generating fresh URL for image ${image._id}:`, urlError);
          // Return image with original URL if fresh URL generation fails
          return image.toObject();
        }
      })
    );
    
    res.json({ success: true, images: imagesWithFreshUrls });
  } catch (err) {
    console.error('Error fetching images by image pool ID:', err);
    res.status(500).json({ success: false, error: "Failed to fetch images" });
  }
};

// Delete a single image
exports.deleteImage = async (req, res) => {
  try {
    const { imageId } = req.params;
    
    console.log('Deleting image:', imageId);
    
    // Find the image first
    const image = await Image.findById(imageId);
    if (!image) {
      return res.status(404).json({ success: false, error: 'Image not found' });
    }
    
    // Delete from S3
    if (image.s3Key) {
      try {
        await deleteObject(image.s3Key);
        console.log('Image deleted from S3:', image.s3Key);
      } catch (s3Error) {
        console.error('Error deleting from S3:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }
    
    // Delete from database
    await Image.findByIdAndDelete(imageId);
    
    // Update image pool image count
    if (image.imagePoolId) {
      await ImagePool.findByIdAndUpdate(
        image.imagePoolId,
        { $inc: { imageCount: -1 } }
      );
    }
    
    console.log('Image deleted successfully:', imageId);
    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Error deleting image:', err);
    res.status(500).json({ success: false, error: 'Failed to delete image', details: err.message });
  }
};

// Delete multiple images
exports.deleteMultipleImages = async (req, res) => {
  try {
    const { imageIds } = req.body;
    
    if (!imageIds || !Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ success: false, error: 'imageIds array is required' });
    }
    
    console.log('Deleting multiple images:', imageIds);
    
    // Find all images to be deleted
    const images = await Image.find({ _id: { $in: imageIds } });
    
    if (images.length === 0) {
      return res.status(404).json({ success: false, error: 'No images found to delete' });
    }
    
    // Group images by imagePoolId for count updates
    const poolUpdates = {};
    
    // Delete from S3 and prepare image pool updates
    const deletePromises = images.map(async (image) => {
      if (image.s3Key) {
        try {
          await deleteObject(image.s3Key);
          console.log('Image deleted from S3:', image.s3Key);
        } catch (s3Error) {
          console.error('Error deleting from S3:', s3Error);
        }
      }
      
      // Track image pool updates
      if (image.imagePoolId) {
        poolUpdates[image.imagePoolId] = (poolUpdates[image.imagePoolId] || 0) + 1;
      }
    });
    
    await Promise.all(deletePromises);
    
    // Delete from database
    await Image.deleteMany({ _id: { $in: imageIds } });
    
    // Update image pool image counts
    const poolUpdatePromises = Object.entries(poolUpdates).map(([imagePoolId, count]) => 
      ImagePool.findByIdAndUpdate(imagePoolId, { $inc: { imageCount: -count } })
    );
    
    await Promise.all(poolUpdatePromises);
    
    console.log('Multiple images deleted successfully:', imageIds.length);
    res.json({ 
      success: true,
      message: `${images.length} images deleted successfully`,
      deletedCount: images.length
    });
  } catch (err) {
    console.error('Error deleting multiple images:', err);
    res.status(500).json({ success: false, error: 'Failed to delete images', details: err.message });
  }
};

// Delete all images from an image pool
exports.deleteAllImagesFromPool = async (req, res) => {
  try {
    const { imagePoolId } = req.params;
    
    console.log('Deleting all images from image pool:', imagePoolId);
    
    // Find all images in the image pool
    const images = await Image.find({ imagePoolId });
    
    if (images.length === 0) {
      return res.json({ 
        success: true,
        message: 'No images found in image pool',
        deletedCount: 0
      });
    }
    
    // Delete from S3
    const s3DeletePromises = images.map(async (image) => {
      if (image.s3Key) {
        try {
          await deleteObject(image.s3Key);
          console.log('Image deleted from S3:', image.s3Key);
        } catch (s3Error) {
          console.error('Error deleting from S3:', s3Error);
        }
      }
    });
    
    await Promise.all(s3DeletePromises);
    
    // Delete from database
    await Image.deleteMany({ imagePoolId });
    
    // Reset image pool image count
    await ImagePool.findByIdAndUpdate(imagePoolId, { imageCount: 0 });
    
    console.log('All images deleted from image pool successfully:', images.length);
    res.json({ 
      success: true,
      message: `All images deleted from image pool successfully`,
      deletedCount: images.length
    });
  } catch (err) {
    console.error('Error deleting all images from image pool:', err);
    res.status(500).json({ success: false, error: 'Failed to delete images from image pool', details: err.message });
  }
};
