const TransactionHistory = require('../models/TransactionHistory');
const CreditWallet = require('../models/CreditWallet');

// ── GET /api/transaction-history — user's transaction history ────────────────
exports.getTransactionHistory = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { page = 1, limit = 20, type, startDate, endDate } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    const filter = { userId };
    
    // Filter by type if provided
    if (type && ['earning', 'penalty', 'bonus', 'refund', 'adjustment', 'campaign_reward'].includes(type)) {
      filter.type = type;
    }
    
    // Filter by date range if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const total = await TransactionHistory.countDocuments(filter);
    const transactions = await TransactionHistory.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    
    const wallet = await CreditWallet.findOne({ userId }).lean();
    
    res.json({
      success: true,
      transactions,
      total,
      page: Number(page),
      limit: Number(limit),
      wallet: wallet || { totalBalance: 0, pendingCredits: 0, totalWithdrawn: 0 },
    });
  } catch (err) {
    console.error('[TransactionHistory] getTransactionHistory error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/transaction-history/stats — user's transaction statistics ───────
exports.getTransactionStats = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { startDate, endDate } = req.query;
    
    const filter = { userId, status: 'completed' };
    
    // Filter by date range if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    // Get all transactions for the period
    const transactions = await TransactionHistory.find(filter).lean();
    
    // Calculate statistics
    const stats = {
      totalEarnings: 0,
      totalPenalties: 0,
      totalBonuses: 0,
      totalRefunds: 0,
      netAmount: 0,
      transactionCount: transactions.length,
      earningCount: 0,
      penaltyCount: 0,
      bonusCount: 0,
      refundCount: 0,
    };
    
    transactions.forEach(tx => {
      if (tx.type === 'earning' || tx.type === 'campaign_reward') {
        stats.totalEarnings += tx.amount;
        stats.earningCount++;
      } else if (tx.type === 'penalty') {
        stats.totalPenalties += Math.abs(tx.amount);
        stats.penaltyCount++;
      } else if (tx.type === 'bonus') {
        stats.totalBonuses += tx.amount;
        stats.bonusCount++;
      } else if (tx.type === 'refund') {
        stats.totalRefunds += tx.amount;
        stats.refundCount++;
      }
      stats.netAmount += tx.amount;
    });
    
    const wallet = await CreditWallet.findOne({ userId }).lean();
    
    res.json({
      success: true,
      stats,
      wallet: wallet || { totalBalance: 0, pendingCredits: 0, totalWithdrawn: 0 },
      period: { startDate, endDate },
    });
  } catch (err) {
    console.error('[TransactionHistory] getTransactionStats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/transaction-history/earnings — user's earnings only ──────────────
exports.getEarnings = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { page = 1, limit = 20, startDate, endDate } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    const filter = { userId, type: { $in: ['earning', 'campaign_reward'] }, status: 'completed' };
    
    // Filter by date range if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const total = await TransactionHistory.countDocuments(filter);
    const earnings = await TransactionHistory.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    
    const totalEarned = await TransactionHistory.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    
    res.json({
      success: true,
      earnings,
      total,
      totalEarned: totalEarned[0]?.total || 0,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error('[TransactionHistory] getEarnings error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/transaction-history/penalties — user's penalties only ────────────
exports.getPenalties = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { page = 1, limit = 20, startDate, endDate } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    const filter = { userId, type: 'penalty', status: 'completed' };
    
    // Filter by date range if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const total = await TransactionHistory.countDocuments(filter);
    const penalties = await TransactionHistory.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    
    const totalPenalties = await TransactionHistory.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } },
    ]);
    
    res.json({
      success: true,
      penalties,
      total,
      totalPenalties: totalPenalties[0]?.total || 0,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error('[TransactionHistory] getPenalties error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/transaction-history — admin: create transaction (internal use) ──
exports.createTransaction = async (req, res) => {
  try {
    const { userId, type, amount, description, referenceType, referenceId, meta } = req.body;
    
    if (!userId || !type || amount === undefined) {
      return res.status(400).json({ success: false, message: 'userId, type, amount required' });
    }
    
    if (!['earning', 'penalty', 'bonus', 'refund', 'adjustment', 'campaign_reward'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid transaction type' });
    }
    
    // Get current balance and update wallet atomically
    const wallet = await CreditWallet.findOneAndUpdate(
      { userId },
      { $inc: { totalBalance: Number(amount) } },
      { new: true, upsert: true }
    );
    const balanceAfter = wallet.totalBalance;
    
    const transaction = await TransactionHistory.create({
      userId,
      type,
      amount: Number(amount),
      description: description || '',
      referenceType: referenceType || 'manual',
      referenceId: referenceId || '',
      status: 'completed',
      meta: meta || {},
      balanceAfter,
    });
    
    res.status(201).json({ success: true, transaction, message: 'Transaction created' });
  } catch (err) {
    console.error('[TransactionHistory] createTransaction error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/transaction-history/summary — quick summary for dashboard ────────
exports.getTransactionSummary = async (req, res) => {
  try {
    const userId = String(req.user.id);
    
    // Get last 30 days transactions
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const filter = { userId, createdAt: { $gte: thirtyDaysAgo }, status: 'completed' };
    
    const transactions = await TransactionHistory.find(filter).lean();
    
    const summary = {
      last30Days: {
        earnings: 0,
        penalties: 0,
        bonuses: 0,
        net: 0,
      },
      allTime: {
        earnings: 0,
        penalties: 0,
        bonuses: 0,
        net: 0,
      },
    };
    
    // Calculate last 30 days
    transactions.forEach(tx => {
      if (tx.type === 'earning' || tx.type === 'campaign_reward') {
        summary.last30Days.earnings += tx.amount;
      } else if (tx.type === 'penalty') {
        summary.last30Days.penalties += Math.abs(tx.amount);
      } else if (tx.type === 'bonus') {
        summary.last30Days.bonuses += tx.amount;
      }
      summary.last30Days.net += tx.amount;
    });
    
    // Calculate all time using aggregation (efficient)
    const allTimeAgg = await TransactionHistory.aggregate([
      { $match: { userId, status: 'completed' } },
      { $group: {
        _id: '$type',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      }},
    ]);
    allTimeAgg.forEach(({ _id: type, total }) => {
      if (type === 'earning' || type === 'campaign_reward') summary.allTime.earnings += total;
      else if (type === 'penalty') summary.allTime.penalties += Math.abs(total);
      else if (type === 'bonus') summary.allTime.bonuses += total;
      summary.allTime.net += total;
    });
    
    const wallet = await CreditWallet.findOne({ userId }).lean();
    
    res.json({
      success: true,
      summary,
      wallet: wallet || { totalBalance: 0, pendingCredits: 0, totalWithdrawn: 0 },
    });
  } catch (err) {
    console.error('[TransactionHistory] getTransactionSummary error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
