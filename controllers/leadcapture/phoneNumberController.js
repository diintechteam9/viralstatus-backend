const PhoneNumber = require('../../models/leadcapture/PhoneNumber');
const Screenshot = require('../../models/leadcapture/Screenshot');
const { generateExcelBuffer, generateCSV } = require('../../utils/leadcapture/excelGenerator');

// Get all phone numbers
const getAllPhoneNumbers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      isValid, 
      countryCode, 
      minConfidence,
      search,
      cardId
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    // Build query
    let query = {};
    
    if (isValid !== undefined && isValid !== '') {
      query.isValid = isValid === 'true';
    }
    
    if (countryCode) {
      query.countryCode = countryCode;
    }
    
    if (minConfidence) {
      query.confidence = { $gte: parseFloat(minConfidence) };
    }
    
    if (search) {
      query.$or = [
        { phoneNumber: { $regex: search, $options: 'i' } },
        { context: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (cardId) {
      query.cardId = cardId;
    }

    console.log('Phone number query:', query);
    console.log('isValid filter:', isValid, 'processed as:', isValid !== undefined && isValid !== '' ? (isValid === 'true') : 'no filter');
    
    const phoneNumbers = await PhoneNumber.find(query)
      .populate('screenshot', 'url title filename createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await PhoneNumber.countDocuments(query);

    console.log(`Found ${phoneNumbers.length} phone numbers out of ${total} total`);

    res.json({
      success: true,
      data: {
        phoneNumbers,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get phone numbers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching phone numbers',
      error: error.message
    });
  }
};

// Get single phone number
const getPhoneNumber = async (req, res) => {
  try {
    const { phoneNumberId } = req.params;

    const phoneNumber = await PhoneNumber.findById(phoneNumberId)
      .populate('screenshot');

    if (!phoneNumber) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not found'
      });
    }

    res.json({
      success: true,
      data: phoneNumber
    });

  } catch (error) {
    console.error('Get phone number error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching phone number',
      error: error.message
    });
  }
};

// Update phone number
const updatePhoneNumber = async (req, res) => {
  try {
    const { phoneNumberId } = req.params;
    const { isValid, context, confidence } = req.body;

    const phoneNumber = await PhoneNumber.findById(phoneNumberId);
    if (!phoneNumber) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not found'
      });
    }

    // Update fields if provided
    if (isValid !== undefined) phoneNumber.isValid = isValid;
    if (context !== undefined) phoneNumber.context = context;
    if (confidence !== undefined) phoneNumber.confidence = confidence;

    await phoneNumber.save();

    res.json({
      success: true,
      message: 'Phone number updated successfully',
      data: phoneNumber
    });

  } catch (error) {
    console.error('Update phone number error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating phone number',
      error: error.message
    });
  }
};

// Delete phone number
const deletePhoneNumber = async (req, res) => {
  try {
    const { phoneNumberId } = req.params;

    const phoneNumber = await PhoneNumber.findById(phoneNumberId);
    if (!phoneNumber) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not found'
      });
    }

    await PhoneNumber.findByIdAndDelete(phoneNumberId);

    res.json({
      success: true,
      message: 'Phone number deleted successfully'
    });

  } catch (error) {
    console.error('Delete phone number error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting phone number',
      error: error.message
    });
  }
};

// Delete all phone numbers
const deleteAllPhoneNumbers = async (req, res) => {
  try {
    const result = await PhoneNumber.deleteMany({});
    
    res.json({
      success: true,
      message: `All phone numbers deleted successfully. ${result.deletedCount} phone numbers removed.`,
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('Delete all phone numbers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting all phone numbers',
      error: error.message
    });
  }
};

// Get phone number statistics
const getPhoneNumberStats = async (req, res) => {
  try {
    const { cardId } = req.query;
    
    let query = {};
    if (cardId) {
      query.cardId = cardId;
    }
    
    const totalPhoneNumbers = await PhoneNumber.countDocuments(query);
    const validPhoneNumbers = await PhoneNumber.countDocuments({ ...query, isValid: true });
    const invalidPhoneNumbers = totalPhoneNumbers - validPhoneNumbers;

    // Country code breakdown
    const countryBreakdown = await PhoneNumber.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$countryCode',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Confidence distribution
    const confidenceStats = await PhoneNumber.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          avgConfidence: { $avg: '$confidence' },
          minConfidence: { $min: '$confidence' },
          maxConfidence: { $max: '$confidence' }
        }
      }
    ]);

    // Recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentPhoneNumbers = await PhoneNumber.countDocuments({
      ...query,
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Daily extraction for last 7 days
    const dailyExtractions = await PhoneNumber.aggregate([
      {
        $match: {
          ...query,
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
        totalPhoneNumbers,
        validPhoneNumbers,
        invalidPhoneNumbers,
        validityRate: totalPhoneNumbers > 0 ? (validPhoneNumbers / totalPhoneNumbers * 100).toFixed(2) + '%' : '0%',
        countryBreakdown,
        confidenceStats: confidenceStats[0] || {},
        recentActivity: {
          last30Days: recentPhoneNumbers
        },
        dailyExtractions
      }
    });

  } catch (error) {
    console.error('Get phone number stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching phone number statistics',
      error: error.message
    });
  }
};

// Export phone numbers to Excel
const exportToExcel = async (req, res) => {
  try {
    const { 
      isValid, 
      countryCode, 
      minConfidence,
      dateFrom,
      dateTo,
      cardId,
      ids
    } = req.query;

    // Build query
    let query = {};
    
    // If specific IDs are provided, use them instead of other filters
    if (ids) {
      const idArray = ids.split(',').map(id => id.trim());
      query._id = { $in: idArray };
    } else {
      // Apply other filters only if no specific IDs are provided
      if (isValid !== undefined && isValid !== '') {
        query.isValid = isValid === 'true';
      }
      
      if (countryCode) {
        query.countryCode = countryCode;
      }
      
      if (minConfidence) {
        query.confidence = { $gte: parseFloat(minConfidence) };
      }

      if (dateFrom || dateTo) {
        query.createdAt = {};
        if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
        if (dateTo) query.createdAt.$lte = new Date(dateTo);
      }
    }
    
    if (cardId) {
      query.cardId = cardId;
    }

    const phoneNumbers = await PhoneNumber.find(query)
      .populate('screenshot', 'url title filename createdAt')
      .sort({ createdAt: -1 });

    const screenshots = await Screenshot.find({
      _id: { $in: phoneNumbers.map(p => p.screenshot) }
    });

    const excelBuffer = generateExcelBuffer(phoneNumbers, screenshots);

    const filename = ids ? `selected_phone_numbers_${new Date().toISOString().split('T')[0]}.xlsx` : `phone_numbers_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);

  } catch (error) {
    console.error('Export to Excel error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting to Excel',
      error: error.message
    });
  }
};

// Export phone numbers to CSV
const exportToCSV = async (req, res) => {
  try {
    const { 
      isValid, 
      countryCode, 
      minConfidence,
      dateFrom,
      dateTo,
      cardId
    } = req.query;

    // Build query
    let query = {};
    
    if (isValid !== undefined && isValid !== '') {
      query.isValid = isValid === 'true';
    }
    
    if (countryCode) {
      query.countryCode = countryCode;
    }
    
    if (minConfidence) {
      query.confidence = { $gte: parseFloat(minConfidence) };
    }

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }
    
    if (cardId) {
      query.cardId = cardId;
    }

    const phoneNumbers = await PhoneNumber.find(query)
      .populate('screenshot', 'url title filename createdAt')
      .sort({ createdAt: -1 });

    const screenshots = await Screenshot.find({
      _id: { $in: phoneNumbers.map(p => p.screenshot) }
    });

    const csvData = generateCSV(phoneNumbers, screenshots);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="phone_numbers_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvData);

  } catch (error) {
    console.error('Export to CSV error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting to CSV',
      error: error.message
    });
  }
};

module.exports = {
  getAllPhoneNumbers,
  getPhoneNumber,
  updatePhoneNumber,
  deletePhoneNumber,
  deleteAllPhoneNumbers,
  getPhoneNumberStats,
  exportToExcel,
  exportToCSV
};
