const KYC          = require('../models/KYC');
const CreditWallet  = require('../models/CreditWallet');
const Activity      = require('../models/Activity');
const multer        = require('multer');
const { s3Client }  = require('../utils/r2');
const { getobject } = require('../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const MobileUser    = require('../models/MobileUser');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// ── Upload doc to R2 ──────────────────────────────────────────────────────────
async function uploadDoc(file, userId, docType) {
  const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const key = `kyc/${userId}/${docType}_${Date.now()}.${ext}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));
  const url = await getobject(key);
  return { key, url };
}

// ── GET /api/kyc/me — get KYC status (userId from token) ───────────────────
exports.getKYC = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const kyc = await KYC.findOne({ userId }).lean();
    if (!kyc) return res.json({ success: true, kyc: null, status: 'pending' });
    // Refresh presigned URLs
    if (kyc.panImageKey)    kyc.panImageUrl     = await getobject(kyc.panImageKey).catch(() => kyc.panImageUrl);
    if (kyc.aadharFrontKey) kyc.aadharFrontUrl  = await getobject(kyc.aadharFrontKey).catch(() => kyc.aadharFrontUrl);
    if (kyc.aadharBackKey)  kyc.aadharBackUrl   = await getobject(kyc.aadharBackKey).catch(() => kyc.aadharBackUrl);
    if (kyc.selfieKey)      kyc.selfieUrl       = await getobject(kyc.selfieKey).catch(() => kyc.selfieUrl);
    res.json({ success: true, kyc, status: kyc.status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/kyc/submit — submit KYC docs (multipart) ───────────────────────
exports.submitKYC = [
  upload.fields([
    { name: 'panImage',    maxCount: 1 },
    { name: 'aadharFront', maxCount: 1 },
    { name: 'aadharBack',  maxCount: 1 },
    { name: 'selfie',      maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const userId = String(req.user.id);
      const {
        fullName, dateOfBirth, gender,
        address, city, state, pincode,
        bankName, accountNumber, ifscCode, accountHolder, upiId,
        panNumber, aadharNumber,
      } = req.body;

      let existing = await KYC.findOne({ userId });
      if (existing && existing.status === 'approved') {
        return res.status(400).json({ success: false, message: 'KYC already approved' });
      }

      const update = {
        fullName, dateOfBirth, gender,
        address, city, state, pincode,
        bankName, accountNumber, ifscCode, accountHolder, upiId,
        panNumber, aadharNumber,
        status: 'submitted',
        submittedAt: new Date(),
      };

      // Upload docs if provided
      if (req.files?.panImage?.[0]) {
        const { key, url } = await uploadDoc(req.files.panImage[0], userId, 'pan');
        update.panImageKey = key; update.panImageUrl = url;
      }
      if (req.files?.aadharFront?.[0]) {
        const { key, url } = await uploadDoc(req.files.aadharFront[0], userId, 'aadhar_front');
        update.aadharFrontKey = key; update.aadharFrontUrl = url;
      }
      if (req.files?.aadharBack?.[0]) {
        const { key, url } = await uploadDoc(req.files.aadharBack[0], userId, 'aadhar_back');
        update.aadharBackKey = key; update.aadharBackUrl = url;
      }
      if (req.files?.selfie?.[0]) {
        const { key, url } = await uploadDoc(req.files.selfie[0], userId, 'selfie');
        update.selfieKey = key; update.selfieUrl = url;
      }

      const kyc = await KYC.findOneAndUpdate(
        { userId },
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Log activity
      const user = await MobileUser.findOne({ googleId: userId }).select('name').lean();
      Activity.create({
        actorId: userId, actorName: user?.name || '', actorRole: 'user',
        type: 'kyc_submitted', description: `${user?.name || userId} submitted KYC`,
      }).catch(() => {});

      res.json({ success: true, kyc, message: 'KYC submitted for review' });
    } catch (err) {
      console.error('[KYC] submit error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ── PATCH /api/kyc/review/:userId — admin approve/reject ─────────────────────
exports.reviewKYC = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const { userId } = req.params;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be approved or rejected' });
    }
    const kyc = await KYC.findOneAndUpdate(
      { userId },
      {
        status,
        rejectionReason: rejectionReason || '',
        reviewedAt: new Date(),
        reviewedBy: String(req.user?.id || ''),
      },
      { new: true }
    );
    if (!kyc) return res.status(404).json({ success: false, message: 'KYC not found' });

    // Update wallet kycVerified flag
    if (status === 'approved') {
      await CreditWallet.findOneAndUpdate(
        { userId },
        { kycVerified: true },
        { upsert: true, new: true }
      );
      Activity.create({
        actorId: userId, actorName: '', actorRole: 'user',
        type: 'kyc_approved', description: `KYC approved for ${userId}`,
      }).catch(() => {});
    }
    res.json({ success: true, kyc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/kyc/list — admin: all KYC records ───────────────────────────────
exports.listKYC = async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const skip  = (Math.max(1, Number(page)) - 1) * Number(limit);
    const total = await KYC.countDocuments(filter);
    const list  = await KYC.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();
    res.json({ success: true, kyc: list, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
