const WithdrawRequest = require('../models/WithdrawRequest');
const CreditWallet    = require('../models/CreditWallet');
const KYC             = require('../models/KYC');
const Activity        = require('../models/Activity');
const MobileUser      = require('../models/MobileUser');

const MIN_WITHDRAW = 100; // minimum credits to withdraw

// ── POST /api/withdraw — user requests withdrawal ────────────────────────────
exports.requestWithdraw = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { amount, method } = req.body;
    if (!amount || !method) {
      return res.status(400).json({ success: false, message: 'amount, method required' });
    }
    if (!['bank', 'upi'].includes(method)) {
      return res.status(400).json({ success: false, message: 'method must be bank or upi' });
    }
    if (Number(amount) < MIN_WITHDRAW) {
      return res.status(400).json({ success: false, message: `Minimum withdrawal is ${MIN_WITHDRAW} credits` });
    }

    // KYC check
    const kyc = await KYC.findOne({ userId }).lean();
    if (!kyc || kyc.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'KYC verification required before withdrawal',
        kycRequired: true,
        kycStatus: kyc?.status || 'pending',
      });
    }

    // Wallet check
    const wallet = await CreditWallet.findOne({ userId });
    if (!wallet || wallet.totalBalance < Number(amount)) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    // Check for existing pending request
    const existing = await WithdrawRequest.findOne({ userId, status: { $in: ['pending', 'processing'] } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have a pending withdrawal request' });
    }

    // Snapshot payment details from KYC
    const paymentDetails = method === 'upi'
      ? { upiId: kyc.upiId }
      : { bankName: kyc.bankName, accountNumber: kyc.accountNumber, ifscCode: kyc.ifscCode, accountHolder: kyc.accountHolder };

    const request = await WithdrawRequest.create({
      userId,
      amount: Number(amount),
      method,
      ...paymentDetails,
      status: 'pending',
    });

    // Deduct from wallet (hold it)
    wallet.totalBalance   -= Number(amount);
    wallet.pendingWithdraw = (wallet.pendingWithdraw || 0) + Number(amount);
    await wallet.save();

    // Activity log
    const user = await MobileUser.findOne({ googleId: userId }).select('name').lean();
    Activity.create({
      actorId: userId, actorName: user?.name || '', actorRole: 'user',
      type: 'withdrawal_request',
      description: `${user?.name || userId} requested withdrawal of ${amount} credits`,
      meta: { amount: Number(amount), credits: Number(amount) },
    }).catch(() => {});

    res.json({ success: true, request, message: 'Withdrawal request submitted' });
  } catch (err) {
    console.error('[Withdraw] request error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/withdraw/history — user's withdrawal history ───────────────────
exports.getUserWithdrawals = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { page = 1, limit = 20 } = req.query;
    const skip  = (Number(page) - 1) * Number(limit);
    const total = await WithdrawRequest.countDocuments({ userId });
    const list  = await WithdrawRequest.find({ userId })
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();
    const wallet = await CreditWallet.findOne({ userId }).lean();
    res.json({ success: true, withdrawals: list, total, wallet });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/withdraw/admin/list — admin: all requests ──────────────────────
exports.listWithdrawals = async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const skip  = (Number(page) - 1) * Number(limit);
    const total = await WithdrawRequest.countDocuments(filter);
    const list  = await WithdrawRequest.find(filter)
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();
    res.json({ success: true, withdrawals: list, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/withdraw/admin/:requestId — admin process/reject ──────────────
exports.processWithdrawal = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, transactionId, rejectionReason, note } = req.body;
    if (!['completed', 'rejected', 'processing'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const request = await WithdrawRequest.findById(requestId);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Already completed' });
    }

    const prevStatus = request.status;
    request.status          = status;
    request.transactionId   = transactionId || '';
    request.rejectionReason = rejectionReason || '';
    request.note            = note || '';
    request.processedAt     = new Date();
    request.processedBy     = String(req.user?.id || '');
    await request.save();

    // Update wallet
    const wallet = await CreditWallet.findOne({ userId: request.userId });
    if (wallet) {
      if (status === 'completed') {
        wallet.pendingWithdraw = Math.max(0, (wallet.pendingWithdraw || 0) - request.amount);
        wallet.totalWithdrawn  = (wallet.totalWithdrawn || 0) + request.amount;
        await wallet.save();

        Activity.create({
          actorId: request.userId, actorName: '', actorRole: 'user',
          type: 'withdrawal_paid',
          description: `Withdrawal of ${request.amount} credits completed`,
          meta: { amount: request.amount, credits: request.amount },
        }).catch(() => {});

      } else if (status === 'rejected' && prevStatus !== 'completed') {
        // Refund back to balance
        wallet.totalBalance    = (wallet.totalBalance || 0) + request.amount;
        wallet.pendingWithdraw = Math.max(0, (wallet.pendingWithdraw || 0) - request.amount);
        await wallet.save();
      }
    }

    res.json({ success: true, request });
  } catch (err) {
    console.error('[Withdraw] process error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
