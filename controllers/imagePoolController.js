const ImagePool = require('../models/imagePool');
const { putobject } = require('../utils/r2'); 
const Image = require('../models/Image');
const { deleteObject } = require('../utils/r2');
const Client = require('../models/client');
const mongoose = require('mongoose');

// Resolve client by either Mongo _id (clientId) or googleId provided
async function resolveClient(req) {
  const { clientId, googleId } = { ...req.body, ...req.query, ...req.params };
  if (!clientId && !googleId) {
    return { error: 'clientId or googleId is required' };
  }
  let query;
  // Prefer explicit googleId if provided
  if (googleId) {
    query = { googleId };
  } else if (clientId) {
    if (mongoose.Types.ObjectId.isValid(clientId)) {
      query = { _id: clientId };
    } else {
      query = { clientId };
    }
  }
  const client = await Client.findOne(query).lean();
  if (!client) {
    return { error: 'Client not found' };
  }
  return { client };
}


// Create a new image pool (scoped to client)
exports.createImagePool = async (req, res) => {
  try {
    console.log('Received image pool creation request:', req.body);
    const { name, description, category } = req.body;
    const resolved = await resolveClient(req);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { client } = resolved;
    
    if (!name) {
      console.log('Image pool name is missing');
      return res.status(400).json({ error: 'Image pool name is required' });
    }
    
    // Check if image pool with same name already exists for this client
    const existingImagePool = await ImagePool.findOne({ name: name.trim(), clientId: client._id });
    if (existingImagePool) {
      console.log('Image pool with this name already exists:', existingImagePool.name);
      return res.status(400).json({ 
        error: 'Image pool with this name already exists. Please choose a different name.',
        existingImagePool: {
          id: existingImagePool._id,
          name: existingImagePool.name,
          description: existingImagePool.description,
          category: existingImagePool.category
        }
      });
    }
    
    console.log('Creating image pool with data:', { name, description, category, clientId: client._id });
    
    // Create image pool without custom imagePoolId
    const imagePool = new ImagePool({ 
      clientId: client._id,
      name: name.trim(), 
      description, 
      category 
    });
    
    await imagePool.save();
    console.log('Image pool created successfully:', imagePool);
    res.status(201).json({ message: 'Image pool created successfully', imagePool });
  } catch (err) {
    console.error('Error creating image pool:', err);
    res.status(500).json({ error: 'Failed to create image pool', details: err.message });
  }
};

// Update image pool (only if owned by client)
exports.updateImagePool = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category } = req.body;
    const resolved = await resolveClient(req);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { client } = resolved;
    
    console.log('Updating image pool:', id, req.body);
    
    if (!name) {
      return res.status(400).json({ error: 'Image pool name is required' });
    }
    
    // Check if image pool exists and belongs to client
    const existingImagePool = await ImagePool.findOne({ _id: id, clientId: client._id });
    if (!existingImagePool) {
      return res.status(404).json({ error: 'Image pool not found or not owned by client' });
    }
    
    // Check if new name conflicts with another image pool (excluding current image pool)
    const nameConflict = await ImagePool.findOne({ name: name.trim(), clientId: client._id, _id: { $ne: id } });
    
    if (nameConflict) {
      return res.status(400).json({ 
        error: 'Image pool with this name already exists. Please choose a different name.',
        existingImagePool: {
          id: nameConflict._id,
          name: nameConflict.name,
          description: nameConflict.description,
          category: nameConflict.category
        }
      });
    }
    
    // Update the image pool
    const updatedImagePool = await ImagePool.findOneAndUpdate(
      { _id: id, clientId: client._id },
      { name: name.trim(), description: description || '', category: category || '' },
      { new: true, runValidators: true }
    );
    
    console.log('Image pool updated successfully:', updatedImagePool);
    res.json({ message: 'Image pool updated successfully', imagePool: updatedImagePool });
  } catch (err) {
    console.error('Error updating image pool:', err);
    res.status(500).json({ error: 'Failed to update image pool', details: err.message });
  }
};

// Delete image pool (only if owned by client)
exports.deleteImagePool = async (req, res) => {
  try {
    const { id } = req.params;
    const resolved = await resolveClient(req);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { client } = resolved;
    
    console.log('Deleting image pool:', id);
    // Check if image pool exists and owned by client
    const existingImagePool = await ImagePool.findOne({ _id: id, clientId: client._id });
    console.log(existingImagePool);

    if (!existingImagePool) {
      return res.status(404).json({ error: 'Image pool not found or not owned by client' });
    }
    
    // First, delete all images from this image pool
    const images = await Image.find({ imagePoolId: id });
    console.log(`Found ${images.length} images to delete from image pool`);
    
    if (images.length > 0) {
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
      await Image.deleteMany({ imagePoolId: id });
      console.log(`Deleted ${images.length} images from database`);
    }
    
    // Delete the image pool (scoped to client)
    await ImagePool.findOneAndDelete({ _id: id, clientId: client._id });
    
    console.log('Image pool deleted successfully:', id);
    res.json({ 
      message: 'Image pool deleted successfully',
      deletedImagesCount: images.length
    });
  } catch (err) {
    console.error('Error deleting image pool:', err);
    res.status(500).json({ error: 'Failed to delete image pool', details: err.message });
  }
};

// Get all image pools for a client (by clientId or googleId)
exports.getImagePools = async (req, res) => {
  try {
    const resolved = await resolveClient(req);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { client } = resolved;
    console.log('Fetching image pools for client:', client._id);
    const imagePools = await ImagePool.find({ clientId: client._id }).sort({ createdAt: -1 });
    console.log('Found image pools:', imagePools.length);
    res.json({ imagePools });
  } catch (err) {
    console.error('Error fetching image pools:', err);
    res.status(500).json({ error: 'Failed to fetch image pools', details: err.message });
  }
};
