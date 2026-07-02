const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const AppClient = require('../models/AppClient');
const { r2Client, BUCKET_NAME } = require('../config/r2');
const { getobject, deleteObject } = require('../utils/r2');

const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_LOGO_SIZE = 5 * 1024 * 1024;

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/appclient-logos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `appclient-logo-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
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
  const logoKey = `appclients/logos/${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

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

async function enrichWithFreshLogoUrl(doc) {
  const plain = stripSensitive(doc);
  if (plain.logoKey) {
    try {
      plain.logoUrl = await getobject(plain.logoKey);
    } catch (err) {
      console.error('[AppClient] logo URL refresh failed:', err.message);
    }
  }
  plain.logoPreview = plain.logoUrl || null;
  return plain;
}

function resolveAppId(req) {
  const queryAppId = req.query.appId;
  if (req.auth.type === 'appclient') {
    return req.auth.appId;
  }
  return queryAppId ? String(queryAppId) : null;
}

function parseBodyFields(body) {
  return {
    appId: body.appId,
    name: body.name?.trim(),
    company: body.company?.trim() || '',
    websiteUrl: body.websiteUrl?.trim() || '',
    email: body.email?.trim()?.toLowerCase(),
    password: body.password,
    mobile: body.mobile?.trim() || '',
    gstNumber: body.gstNumber?.trim() || '',
    panNumber: body.panNumber?.trim() || '',
    address: body.address?.trim() || '',
    city: body.city?.trim() || '',
    state: body.state?.trim() || '',
    pincode: body.pincode?.trim() || '',
    country: body.country?.trim() || '',
    status: body.status,
  };
}

exports.uploadLogo = uploadLogo;

exports.getAllAppClients = async (req, res) => {
  try {
    const appId = resolveAppId(req);
    if (!appId) {
      return res.status(400).json({ success: false, message: 'appId is required' });
    }

    const clients = await AppClient.find({ appId }).sort({ createdAt: -1 });
    const data = await Promise.all(clients.map((c) => enrichWithFreshLogoUrl(c)));

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[getAllAppClients]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch app clients' });
  }
};

exports.createAppClient = async (req, res) => {
  try {
    const fields = parseBodyFields(req.body);
    const appId = req.auth.type === 'appclient' ? req.auth.appId : fields.appId;

    if (!appId) {
      return res.status(400).json({ success: false, message: 'appId is required' });
    }
    if (!fields.name || !fields.email || !fields.password) {
      return res.status(400).json({ success: false, message: 'name, email and password are required' });
    }

    const existing = await AppClient.findOne({ appId, email: fields.email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered for this app' });
    }

    let logoKey = '';
    let logoUrl = '';
    if (req.file) {
      const uploaded = await uploadLogoToR2(req.file);
      logoKey = uploaded.logoKey;
      logoUrl = uploaded.logoUrl;
    }

    const client = await AppClient.create({
      appId,
      name: fields.name,
      company: fields.company,
      websiteUrl: fields.websiteUrl,
      email: fields.email,
      password: fields.password,
      mobile: fields.mobile,
      gstNumber: fields.gstNumber,
      panNumber: fields.panNumber,
      address: fields.address,
      city: fields.city,
      state: fields.state,
      pincode: fields.pincode,
      country: fields.country,
      logoKey,
      logoUrl,
    });

    const data = await enrichWithFreshLogoUrl(client);
    return res.status(201).json({ success: true, data, message: 'AppClient created successfully' });
  } catch (err) {
    console.error('[createAppClient]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create app client' });
  }
};

exports.updateAppClient = async (req, res) => {
  try {
    const client = await AppClient.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'AppClient not found' });
    }

    if (req.auth.type === 'appclient' && String(client.appId) !== req.auth.appId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const fields = parseBodyFields(req.body);

    if (fields.email && fields.email !== client.email) {
      const dup = await AppClient.findOne({ appId: client.appId, email: fields.email, _id: { $ne: client._id } });
      if (dup) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
      client.email = fields.email;
    }

    if (fields.name) client.name = fields.name;
    if (fields.company !== undefined) client.company = fields.company;
    if (fields.websiteUrl !== undefined) client.websiteUrl = fields.websiteUrl;
    if (fields.mobile !== undefined) client.mobile = fields.mobile;
    if (fields.gstNumber !== undefined) client.gstNumber = fields.gstNumber;
    if (fields.panNumber !== undefined) client.panNumber = fields.panNumber;
    if (fields.address !== undefined) client.address = fields.address;
    if (fields.city !== undefined) client.city = fields.city;
    if (fields.state !== undefined) client.state = fields.state;
    if (fields.pincode !== undefined) client.pincode = fields.pincode;
    if (fields.country !== undefined) client.country = fields.country;
    if (fields.status && ['active', 'inactive'].includes(fields.status)) client.status = fields.status;
    if (fields.password && fields.password.trim()) client.password = fields.password;

    if (req.file) {
      if (client.logoKey) {
        try {
          await deleteObject(client.logoKey);
        } catch (err) {
          console.error('[updateAppClient] old logo delete failed:', err.message);
        }
      }
      const uploaded = await uploadLogoToR2(req.file);
      client.logoKey = uploaded.logoKey;
      client.logoUrl = uploaded.logoUrl;
    }

    await client.save();
    const data = await enrichWithFreshLogoUrl(client);
    return res.json({ success: true, data, message: 'AppClient updated successfully' });
  } catch (err) {
    console.error('[updateAppClient]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update app client' });
  }
};

exports.deleteAppClient = async (req, res) => {
  try {
    const client = await AppClient.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'AppClient not found' });
    }

    if (req.auth.type === 'appclient' && String(client.appId) !== req.auth.appId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (client.logoKey) {
      try {
        await deleteObject(client.logoKey);
      } catch (err) {
        console.error('[deleteAppClient] logo delete failed:', err.message);
      }
    }

    await AppClient.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'AppClient deleted successfully' });
  } catch (err) {
    console.error('[deleteAppClient]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to delete app client' });
  }
};
