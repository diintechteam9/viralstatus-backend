const Card = require('../../models/leadcapture/Card');

// Get all cards
const getAllCards = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    // Build query
    let query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const cards = await Card.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Card.countDocuments(query);

    res.json({
      success: true,
      data: {
        cards,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get cards error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cards',
      error: error.message
    });
  }
};

// Get single card
const getCard = async (req, res) => {
  try {
    const { cardId } = req.params;

    const card = await Card.findById(cardId);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card not found'
      });
    }

    res.json({
      success: true,
      data: card
    });

  } catch (error) {
    console.error('Get card error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching card',
      error: error.message
    });
  }
};

// Create new card
const createCard = async (req, res) => {
  try {
    const { name, description, tags } = req.body;

    // Validate required fields
    if (!name || !description) {
      return res.status(400).json({
        success: false,
        message: 'Name and description are required'
      });
    }

    const card = new Card({
      name,
      description,
      tags: tags || []
    });

    await card.save();

    res.status(201).json({
      success: true,
      message: 'Card created successfully',
      data: card
    });

  } catch (error) {
    console.error('Create card error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating card',
      error: error.message
    });
  }
};

// Update card
const updateCard = async (req, res) => {
  try {
    const { cardId } = req.params;
    const { name, description, status, tags } = req.body;

    const card = await Card.findById(cardId);
    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card not found'
      });
    }

    // Update fields if provided
    if (name !== undefined) card.name = name;
    if (description !== undefined) card.description = description;
    if (status !== undefined) card.status = status;
    if (tags !== undefined) card.tags = tags;

    await card.save();

    res.json({
      success: true,
      message: 'Card updated successfully',
      data: card
    });

  } catch (error) {
    console.error('Update card error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating card',
      error: error.message
    });
  }
};

// Delete card
const deleteCard = async (req, res) => {
  try {
    const { cardId } = req.params;

    const card = await Card.findById(cardId);
    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Card not found'
      });
    }

    await Card.findByIdAndDelete(cardId);

    res.json({
      success: true,
      message: 'Card deleted successfully'
    });

  } catch (error) {
    console.error('Delete card error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting card',
      error: error.message
    });
  }
};

// Delete all cards
const deleteAllCards = async (req, res) => {
  try {
    const result = await Card.deleteMany({});
    
    res.json({
      success: true,
      message: `All cards deleted successfully. ${result.deletedCount} cards removed.`,
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('Delete all cards error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting all cards',
      error: error.message
    });
  }
};

// Get card statistics
const getCardStats = async (req, res) => {
  try {
    const totalCards = await Card.countDocuments();
    const activeCards = await Card.countDocuments({ status: 'active' });
    const inactiveCards = await Card.countDocuments({ status: 'inactive' });
    const archivedCards = await Card.countDocuments({ status: 'archived' });

    // Status breakdown
    const statusBreakdown = await Card.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentCards = await Card.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Daily creation for last 7 days
    const dailyCreations = await Card.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        totalCards,
        activeCards,
        inactiveCards,
        archivedCards,
        statusBreakdown,
        recentActivity: {
          last30Days: recentCards
        },
        dailyCreations
      }
    });

  } catch (error) {
    console.error('Get card stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching card statistics',
      error: error.message
    });
  }
};

module.exports = {
  getAllCards,
  getCard,
  createCard,
  updateCard,
  deleteCard,
  deleteAllCards,
  getCardStats
};
