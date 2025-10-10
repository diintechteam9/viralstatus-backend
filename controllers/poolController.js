const Pool = require('../models/pool');
const { putobject } = require('../utils/s3'); 
const Reel = require('../models/Reel');
const { deleteObject } = require('../utils/s3');
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
    // If clientId looks like a Mongo ObjectId, treat it as _id; otherwise treat it as googleId
    if (mongoose.Types.ObjectId.isValid(clientId)) {
      query = { _id: clientId };
    } else {
      query = { googleId: clientId };
    }
  }
  const client = await Client.findOne(query).lean();
  if (!client) {
    return { error: 'Client not found' };
  }
  return { client };
}


// Create a new pool (scoped to client)
exports.createPool = async (req, res) => {
  try {
    console.log('Received pool creation request:', req.body);
    const { name, description, category } = req.body;
    const resolved = await resolveClient(req);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { client } = resolved;
    
    if (!name) {
      console.log('Pool name is missing');
      return res.status(400).json({ error: 'Pool name is required' });
    }
    
    // Check if pool with same name already exists for this client
    const existingPool = await Pool.findOne({ name: name.trim(), clientId: client._id });
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
    
    console.log('Creating pool with data:', { name, description, category, clientId: client._id });
    
    // Create pool without custom poolId
    const pool = new Pool({ 
      clientId: client._id,
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

// Update pool (only if owned by client)
exports.updatePool = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category } = req.body;
    const resolved = await resolveClient(req);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { client } = resolved;
    
    console.log('Updating pool:', id, req.body);
    
    if (!name) {
      return res.status(400).json({ error: 'Pool name is required' });
    }
    
    // Check if pool exists and belongs to client
    const existingPool = await Pool.findOne({ _id: id, clientId: client._id });
    if (!existingPool) {
      return res.status(404).json({ error: 'Pool not found or not owned by client' });
    }
    
    // Check if new name conflicts with another pool (excluding current pool)
    const nameConflict = await Pool.findOne({ name: name.trim(), clientId: client._id, _id: { $ne: id } });
    
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
    const updatedPool = await Pool.findOneAndUpdate(
      { _id: id, clientId: client._id },
      { name: name.trim(), description: description || '', category: category || '' },
      { new: true, runValidators: true }
    );
    
    console.log('Pool updated successfully:', updatedPool);
    res.json({ message: 'Pool updated successfully', pool: updatedPool });
  } catch (err) {
    console.error('Error updating pool:', err);
    res.status(500).json({ error: 'Failed to update pool', details: err.message });
  }
};

// Delete pool (only if owned by client)
exports.deletePool = async (req, res) => {
  try {
    const { id } = req.params;
    const resolved = await resolveClient(req);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { client } = resolved;
    
    console.log('Deleting pool:', id);
    // Check if pool exists and owned by client
    const existingPool = await Pool.findOne({ _id: id, clientId: client._id });
    console.log(existingPool);

    if (!existingPool) {
      return res.status(404).json({ error: 'Pool not found or not owned by client' });
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
    
    // Delete the pool (scoped to client)
    await Pool.findOneAndDelete({ _id: id, clientId: client._id });
    
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

// Get all pools for a client (by clientId or googleId)
exports.getPools = async (req, res) => {
  try {
    const resolved = await resolveClient(req);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { client } = resolved;
    console.log('Fetching pools for client:', client._id);
    const pools = await Pool.find({ clientId: client._id }).sort({ createdAt: -1 });
    console.log('Found pools:', pools.length);
    res.json({ pools });
  } catch (err) {
    console.error('Error fetching pools:', err);
    res.status(500).json({ error: 'Failed to fetch pools', details: err.message });
  }
}; 

