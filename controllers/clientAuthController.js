const Client = require('../models/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// GET /api/admin/get-client-token/:clientMongoId
const getClientToken = async (req, res) => {
  try {
    const secret = req.headers['x-internal-secret'];
    if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const client = await Client.findById(req.params.clientMongoId);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    if (!client.isActive) return res.status(403).json({ success: false, message: 'Client account is inactive' });
    const token = generateToken(client);
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const generateToken = (client) =>
  jwt.sign(
    { id: client._id, clientId: client.clientId, role: 'client' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

// POST /api/auth/client/register
const registerClient = async (req, res) => {
  try {
    const { email, password, businessName, contactPerson, phone } = req.body;
    if (!email || !password || !businessName)
      return res.status(400).json({ success: false, message: 'email, password and businessName required' });

    const exists = await Client.findOne({ email });
    if (exists)
      return res.status(400).json({ success: false, message: 'Email already registered' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const client = await Client.create({ email, password: hashedPassword, businessName, contactPerson, phone });

    const token = generateToken(client);

    res.status(201).json({
      success: true,
      message: 'Client registered successfully',
      data: {
        clientId: client.clientId,
        email: client.email,
        businessName: client.businessName,
        isActive: client.isActive,
        token,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/client/login
const loginClient = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'email and password required' });

    const client = await Client.findOne({ email });
    if (!client)
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    if (!client.isActive)
      return res.status(403).json({ success: false, message: 'Client account is inactive' });

    const isValid = await bcrypt.compare(password, client.password);
    if (!isValid)
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const token = generateToken(client);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        _id: client._id,
        clientId: client.clientId,
        email: client.email,
        name: client.contactPerson || client.businessName,
        businessName: client.businessName,
        isActive: client.isActive,
        token,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/auth/client/me
const getClientProfile = async (req, res) => {
  try {
    const client = await Client.findById(req.client.id).select('-password');
    if (!client)
      return res.status(404).json({ success: false, message: 'Client not found' });

    res.json({ success: true, data: { client } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { registerClient, loginClient, getClientProfile, getClientToken };
