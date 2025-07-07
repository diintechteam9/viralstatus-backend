const Pool = require('../models/pool');
const { putobject } = require('../utils/s3'); 
const Reel = require('../models/Reel');
const { deleteObject } = require('../utils/s3');


// Create a new pool
exports.createPool = async (req, res) => {
  try {
    console.log('Received pool creation request:', req.body);
    const { name, description, category } = req.body;
    
    if (!name) {
      console.log('Pool name is missing');
      return res.status(400).json({ error: 'Pool name is required' });
    }
    
    // Check if pool with same name already exists
    const existingPool = await Pool.findOne({ name: name.trim() });
    if (existingPool) {
      console.log('Pool with this name already exists:', existingPool.name);
      return res.status(400).json({ 
        error: 'Pool with this name already exists. Please choose a different name.',
        existingPool: {
          id: existingPool._id,
          name: existingPool.name,
          description: existingPool.description,
          category: existingPool.category
        }
      });
    }
    
    console.log('Creating pool with data:', { name, description, category });
    
    // Create pool without custom poolId
    const pool = new Pool({ 
      name: name.trim(), 
      description, 
      category 
    });
    
    await pool.save();
    console.log('Pool created successfully:', pool);
    res.status(201).json({ message: 'Pool created successfully', pool });
  } catch (err) {
    console.error('Error creating pool:', err);
    res.status(500).json({ error: 'Failed to create pool', details: err.message });
  }
};

// Update pool
exports.updatePool = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category } = req.body;
    
    console.log('Updating pool:', id, req.body);
    
    if (!name) {
      return res.status(400).json({ error: 'Pool name is required' });
    }
    
    // Check if pool exists
    const existingPool = await Pool.findById(id);
    if (!existingPool) {
      return res.status(404).json({ error: 'Pool not found' });
    }
    
    // Check if new name conflicts with another pool (excluding current pool)
    const nameConflict = await Pool.findOne({ 
      name: name.trim(), 
      _id: { $ne: id } 
    });
    
    if (nameConflict) {
      return res.status(400).json({ 
        error: 'Pool with this name already exists. Please choose a different name.',
        existingPool: {
          id: nameConflict._id,
          name: nameConflict.name,
          description: nameConflict.description,
          category: nameConflict.category
        }
      });
    }
    
    // Update the pool
    const updatedPool = await Pool.findByIdAndUpdate(
      id,
      { 
        name: name.trim(),
        description: description || '',
        category: category || ''
      },
      { new: true, runValidators: true }
    );
    
    console.log('Pool updated successfully:', updatedPool);
    res.json({ message: 'Pool updated successfully', pool: updatedPool });
  } catch (err) {
    console.error('Error updating pool:', err);
    res.status(500).json({ error: 'Failed to update pool', details: err.message });
  }
};

// Delete pool
exports.deletePool = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('Deleting pool:', id);
    // Check if pool exists
    const existingPool = await Pool.findById(id);
    console.log(existingPool);

    if (!existingPool) {
      return res.status(404).json({ error: 'Pool not found' });
    }
    
    // First, delete all reels from this pool
    const reels = await Reel.find({ poolId: id });
    console.log(`Found ${reels.length} reels to delete from pool`);
    
    if (reels.length > 0) {
      // Delete from S3
      const s3DeletePromises = reels.map(async (reel) => {
        if (reel.s3Key) {
          try {
            await deleteObject(reel.s3Key);
            console.log('Reel deleted from S3:', reel.s3Key);
          } catch (s3Error) {
            console.error('Error deleting from S3:', s3Error);
          }
        }
      });
      
      await Promise.all(s3DeletePromises);
      
      // Delete from database
      await Reel.deleteMany({ poolId: id });
      console.log(`Deleted ${reels.length} reels from database`);
    }
    
    // Delete the pool
    await Pool.findByIdAndDelete(id);
    
    console.log('Pool deleted successfully:', id);
    res.json({ 
      message: 'Pool deleted successfully',
      deletedReelsCount: reels.length
    });
  } catch (err) {
    console.error('Error deleting pool:', err);
    res.status(500).json({ error: 'Failed to delete pool', details: err.message });
  }
};

// Get all pools
exports.getPools = async (req, res) => {
  try {
    console.log('Fetching all pools');
    const pools = await Pool.find().sort({ createdAt: -1 });
    console.log('Found pools:', pools.length);
    res.json({ pools });
  } catch (err) {
    console.error('Error fetching pools:', err);
    res.status(500).json({ error: 'Failed to fetch pools', details: err.message });
  }
}; 

