const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const App = require('../models/App');
const { r2Client, BUCKET_NAME } = require('../config/r2');
const { getobject, deleteObject } = require('../utils/r2');

const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_LOGO_SIZE = 5 * 1024 * 1024;

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/app-logos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `app-logo-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: MAX_LOGO_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_LOGO_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only image files are allowed.'));
    }
    cb(null, true);
  },
});

function stripSensitive(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password;
  return obj;
}

async function uploadLogoToR2(file) {
  const ext = path.extname(file.originalname) || path.extname(file.filename) || '.png';
  const logoKey = `apps/logos/${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: logoKey,
      Body: fs.readFileSync(file.path),
      ContentType: file.mimetype || 'image/jpeg',
    })
  );

  fs.unlink(file.path, () => {});

  const logoUrl = await getobject(logoKey);
  return { logoKey, logoUrl };
}

async function enrichWithFreshLogoUrl(appDoc) {
  const plain = stripSensitive(appDoc);
  if (plain.logoKey) {
    try {
      plain.logoUrl = await getobject(plain.logoKey);
    } catch (err) {
      console.error('[App] logo URL refresh failed:', err.message);
    }
  }
  plain.name = plain.businessName;
  plain.logoPreview = plain.logoUrl || null;
  return plain;
}

function parseBodyFields(body) {
  return {
    businessName: body.businessName?.trim(),
    websiteUrl: body.websiteUrl?.trim() || '',
    gstNumber: body.gstNumber?.trim() || '',
    panNumber: body.panNumber?.trim() || '',
    fullName: body.fullName?.trim(),
    email: body.email?.trim()?.toLowerCase(),
    mobile: body.mobile?.trim(),
    city: body.city?.trim() || '',
    address: body.address?.trim() || '',
    pincode: body.pincode?.trim() || '',
    app: body.app?.trim() || '',
    password: body.password,
    confirmPassword: body.confirmPassword,
    status: body.status,
  };
}

exports.uploadLogo = uploadLogo;

exports.createApp = async (req, res) => {
  try {
    const fields = parseBodyFields(req.body);

    if (!fields.businessName || !fields.fullName || !fields.email || !fields.mobile || !fields.password) {
      return res.status(400).json({
        success: false,
        message: 'businessName, fullName, email, mobile and password are required',
      });
    }

    if (fields.password !== fields.confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }

    const existing = await App.findOne({ email: fields.email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    let logoKey = '';
    let logoUrl = '';

    if (req.file) {
      const uploaded = await uploadLogoToR2(req.file);
      logoKey = uploaded.logoKey;
      logoUrl = uploaded.logoUrl;
    }

    const app = await App.create({
      businessName: fields.businessName,
      websiteUrl: fields.websiteUrl,
      gstNumber: fields.gstNumber,
      panNumber: fields.panNumber,
      logoKey,
      logoUrl,
      fullName: fields.fullName,
      email: fields.email,
      mobile: fields.mobile,
      city: fields.city,
      address: fields.address,
      pincode: fields.pincode,
      app: fields.app,
      password: fields.password,
    });

    const data = await enrichWithFreshLogoUrl(app);
    return res.status(201).json({ success: true, data, message: 'App created successfully' });
  } catch (err) {
    console.error('[createApp]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create app' });
  }
};

exports.getAllApps = async (req, res) => {
  try {
    const apps = await App.find().sort({ createdAt: -1 }).lean();
    const data = await Promise.all(apps.map((a) => enrichWithFreshLogoUrl(a)));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[getAllApps]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch apps' });
  }
};

exports.getAppById = async (req, res) => {
  try {
    const app = await App.findById(req.params.appId);
    if (!app) {
      return res.status(404).json({ success: false, message: 'App not found' });
    }
    const data = await enrichWithFreshLogoUrl(app);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[getAppById]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch app' });
  }
};

exports.updateApp = async (req, res) => {
  try {
    const app = await App.findById(req.params.appId);
    if (!app) {
      return res.status(404).json({ success: false, message: 'App not found' });
    }

    const fields = parseBodyFields(req.body);

    if (fields.businessName) app.businessName = fields.businessName;
    if (fields.websiteUrl !== undefined) app.websiteUrl = fields.websiteUrl;
    if (fields.gstNumber !== undefined) app.gstNumber = fields.gstNumber;
    if (fields.panNumber !== undefined) app.panNumber = fields.panNumber;
    if (fields.fullName) app.fullName = fields.fullName;
    if (fields.email) {
      const dup = await App.findOne({ email: fields.email, _id: { $ne: app._id } });
      if (dup) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
      app.email = fields.email;
    }
    if (fields.mobile) app.mobile = fields.mobile;
    if (fields.city !== undefined) app.city = fields.city;
    if (fields.address !== undefined) app.address = fields.address;
    if (fields.pincode !== undefined) app.pincode = fields.pincode;
    if (fields.app !== undefined) app.app = fields.app;
    if (fields.status && ['active', 'inactive'].includes(fields.status)) {
      app.status = fields.status;
    }

    if (req.file) {
      if (app.logoKey) {
        try {
          await deleteObject(app.logoKey);
        } catch (err) {
          console.warn('[updateApp] old logo delete failed:', err.message);
        }
      }
      const uploaded = await uploadLogoToR2(req.file);
      app.logoKey = uploaded.logoKey;
      app.logoUrl = uploaded.logoUrl;
    }

    await app.save();
    const data = await enrichWithFreshLogoUrl(app);
    return res.json({ success: true, data, message: 'App updated successfully' });
  } catch (err) {
    console.error('[updateApp]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update app' });
  }
};

exports.deleteApp = async (req, res) => {
  try {
    const app = await App.findById(req.params.appId);
    if (!app) {
      return res.status(404).json({ success: false, message: 'App not found' });
    }

    if (app.logoKey) {
      try {
        await deleteObject(app.logoKey);
      } catch (err) {
        console.warn('[deleteApp] logo delete failed:', err.message);
      }
    }

    await app.deleteOne();
    return res.json({ success: true, message: 'App deleted successfully' });
  } catch (err) {
    console.error('[deleteApp]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to delete app' });
  }
};

function buildAppClientPayload(appDoc) {
  return {
    role: 'appclient',
    name: appDoc.businessName,
    businessName: appDoc.businessName,
    email: appDoc.email,
    _id: String(appDoc._id),
    appId: String(appDoc._id),
    logoUrl: appDoc.logoUrl || null,
    logoPreview: appDoc.logoUrl || null,
  };
}

function issueAppClientToken(app) {
  return jwt.sign(
    {
      id: app._id,
      email: app.email,
      role: 'appclient',
      businessName: app.businessName,
      appId: app._id,
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

exports.loginApp = async (req, res) => {
  try {
    const { appId, email, password } = req.body;

    // Admin impersonation — open AppClient dashboard for a specific app
    if (appId) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Admin authorization required' });
      }

      let decoded;
      try {
        decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({ success: false, message: 'Invalid admin token' });
      }

      const adminRole = decoded.role || decoded.userType;
      if (!['admin', 'super_admin'].includes(adminRole)) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
      }

      const app = await App.findById(appId);
      if (!app) {
        return res.status(404).json({ success: false, message: 'App not found' });
      }
      if (app.status === 'inactive') {
        return res.status(403).json({ success: false, message: 'App account is inactive' });
      }

      const enriched = await enrichWithFreshLogoUrl(app);
      const token = issueAppClientToken(app);
      const appData = buildAppClientPayload(enriched);

      return res.json({
        success: true,
        data: { token, app: appData },
        message: 'Login successful',
      });
    }

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }

    const app = await App.findOne({ email: email.trim().toLowerCase() }).select('+password');
    if (!app) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (app.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'App account is inactive' });
    }

    const valid = await app.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    app.lastLoginAt = new Date();
    await app.save({ validateBeforeSave: false });

    const enriched = await enrichWithFreshLogoUrl(app);
    const token = issueAppClientToken(app);
    const appData = buildAppClientPayload(enriched);

    return res.json({
      success: true,
      data: { token, app: appData },
      message: 'Login successful',
    });
  } catch (err) {
    console.error('[loginApp]', err);
    return res.status(500).json({ success: false, message: err.message || 'Login failed' });
  }
};
