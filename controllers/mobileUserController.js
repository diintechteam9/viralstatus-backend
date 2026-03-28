const MobileUser = require('../models/MobileUser');
const Client = require('../models/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { r2Client } = require('../config/r2');

// ─── Helpers ────────────────────────────────────────────────────────────────

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const otpExpiry = () => new Date(Date.now() + 10 * 60 * 1000);

const generateToken = (user, client) =>
  jwt.sign(
    { id: user._id, email: user.email, clientId: client.clientId, clientObjectId: client._id, userType: 'mobileuser' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

// Validate clientId (CLI-XXXXXX format)
const validateClientId = async (clientCode) => {
  if (!clientCode) throw new Error('clientId is required');
  const client = await Client.findOne({ clientId: clientCode.toUpperCase() });
  if (!client) throw new Error('Invalid Client ID');
  if (!client.isActive) throw new Error('Client account is inactive');
  return client;
};

// ─── Send Email OTP via Brevo ────────────────────────────────────────────────

const sendEmailOtp = async (email, otp) => {
  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: { name: 'App', email: process.env.BREVO_FROM_EMAIL },
      to: [{ email }],
      subject: 'Your OTP for Registration',
      htmlContent: `<p>Your OTP is <b>${otp}</b>. It is valid for 10 minutes.</p>`,
    },
    { headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' } }
  );
};

// ─── Send Mobile OTP ─────────────────────────────────────────────────────────

const sendMobileOtp = async (mobile, otp, method = 'gupshup') => {
  if (method === 'gupshup') {
    const number = mobile.replace('+', '');
    await axios.get('https://enterprise.smsgupshup.com/GatewayAPI/rest', {
      params: {
        method: 'SendMessage',
        send_to: number,
        msg: `Your OTP is ${otp}. Valid for 10 minutes.`,
        msg_type: 'TEXT',
        userid: process.env.GUPSHUP_USERID,
        auth_scheme: 'plain',
        password: process.env.GUPSHUP_PASSWORD,
        v: '1.1',
        format: 'text',
        mask: process.env.GUPSHUP_MASK || 'MOBISL',
      },
    });
  } else if (method === 'whatsapp') {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const version = process.env.WHATSAPP_GRAPH_VERSION || 'v19.0';
    const to = mobile.replace(/\D/g, '');
    try {
      await axios.post(
        `https://graph.facebook.com/${version}/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: process.env.WHATSAPP_TEMPLATE_NAME || 'otp_verification',
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: otp }] },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] },
            ],
          },
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    } catch (waErr) {
      const waError = waErr.response?.data?.error;
      console.error('WhatsApp API Error:', JSON.stringify(waError || waErr.message));
      throw new Error(`WhatsApp API Error: ${waError?.message || waError?.error_data?.details || waErr.message}`);
    }
  }
};

// ─── STEP 1 — Send Email OTP ─────────────────────────────────────────────────

const step1SendEmailOtp = async (req, res) => {
  try {
    const { email, password, clientId } = req.body;
    if (!email || !password || !clientId)
      return res.status(400).json({ success: false, message: 'email, password and clientId required' });

    const client = await validateClientId(clientId);

    let user = await MobileUser.findOne({ email, clientId: client._id });

    if (user && user.registrationStep === 3)
      return res.status(400).json({ success: false, message: 'Email already registered. Please login.' });

    const otp = generateOtp();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    if (!user) {
      user = await MobileUser.create({
        email,
        password: hashedPassword,
        clientId: client._id,
        clientCode: client.clientId,
        emailOtp: otp,
        emailOtpExpiry: otpExpiry(),
        registrationStep: 0,
      });
    } else {
      user.password = hashedPassword;
      user.emailOtp = otp;
      user.emailOtpExpiry = otpExpiry();
      await user.save();
    }

    await sendEmailOtp(email, otp);

    res.json({
      success: true,
      message: 'OTP sent to your email. Please verify to continue.',
      data: { email, registrationStep: 1, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── STEP 1 VERIFY — Verify Email OTP ────────────────────────────────────────

const step1VerifyEmailOtp = async (req, res) => {
  try {
    const { email, otp, clientId } = req.body;
    if (!email || !otp || !clientId)
      return res.status(400).json({ success: false, message: 'email, otp and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.registrationStep === 3)
      return res.status(400).json({ success: false, message: 'Email already verified. Please login.' });

    if (!user.emailOtp)
      return res.status(400).json({ success: false, message: 'OTP not generated. Please request a new OTP.' });

    if (user.emailOtp !== otp)
      return res.status(400).json({ success: false, message: 'Invalid OTP' });

    if (user.emailOtpExpiry < new Date())
      return res.status(400).json({ success: false, message: 'OTP expired. Please resend.' });

    user.emailVerified = true;
    user.emailOtp = null;
    user.emailOtpExpiry = null;
    user.registrationStep = 1;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: { email, emailVerified: true, mobileVerified: false, profileCompleted: false, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── STEP 2 — Send Mobile OTP ────────────────────────────────────────────────

const step2SendMobileOtp = async (req, res) => {
  try {
    const { email, mobile, otpMethod = 'whatsapp', clientId } = req.body;
    if (!email || !mobile || !clientId)
      return res.status(400).json({ success: false, message: 'email, mobile and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.registrationStep === 3)
      return res.status(400).json({ success: false, message: 'Already registered. Please login.' });
    if (!user.emailVerified) return res.status(400).json({ success: false, message: 'Please verify email first (Step 1)' });

    const otp = generateOtp();

    // Send OTP first — save only if delivery succeeds
    await sendMobileOtp(mobile, otp, otpMethod);

    user.mobile = mobile;
    user.mobileOtp = String(otp);
    user.mobileOtpExpiry = otpExpiry();
    user.otpMethod = otpMethod;
    await user.save();

    res.json({
      success: true,
      message: `OTP sent to your mobile via ${otpMethod.toUpperCase()}. Please verify to continue.`,
      data: { email, mobile, otpMethod, registrationStep: 2, clientId: client.clientId, ...(process.env.NODE_ENV !== 'production' && { otp }) },
    });
  } catch (err) {
    const status = err.message.includes('Client') ? 400 : err.message.includes('WhatsApp') ? 502 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
};

// ─── STEP 2 VERIFY — Verify Mobile OTP ───────────────────────────────────────

const step2VerifyMobileOtp = async (req, res) => {
  try {
    const { email, mobile, otp, clientId } = req.body;
    if (!email || !mobile || !otp || !clientId)
      return res.status(400).json({ success: false, message: 'email, mobile, otp and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.mobileOtp)
      return res.status(400).json({ success: false, message: 'OTP not generated. Please request a new OTP.' });

    if (String(user.mobileOtp).trim() !== String(otp).trim())
      return res.status(400).json({ success: false, message: 'Invalid OTP' });

    if (user.mobileOtpExpiry < new Date())
      return res.status(400).json({ success: false, message: 'OTP expired. Please resend.' });

    user.mobileVerified = true;
    user.mobileOtp = null;
    user.mobileOtpExpiry = null;
    user.registrationStep = 2;
    await user.save();

    res.json({
      success: true,
      message: 'Mobile verified successfully',
      data: { email, mobile, mobileVerified: true, emailVerified: true, profileCompleted: false, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── STEP 3 — Complete Profile ────────────────────────────────────────────────

const step3CompleteProfile = async (req, res) => {
  try {
    const { email, clientId, name, mobileNumber, city, pincode, businessName, gender, ageRange, businessInterests, occupation, highestQualification, fieldOfStudy, skills, socialMedia } = req.body;
    if (!email || !clientId)
      return res.status(400).json({ success: false, message: 'email and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.mobileVerified) return res.status(400).json({ success: false, message: 'Please verify mobile first (Step 2)' });

    if (name) user.name = name;
    if (mobileNumber) user.mobileNumber = mobileNumber;
    if (city) user.city = city;
    if (pincode) user.pincode = pincode;
    if (businessName) user.businessName = businessName;
    if (gender) user.gender = gender;
    if (ageRange) user.ageRange = ageRange;
    if (businessInterests) user.businessInterests = businessInterests;
    if (occupation) user.occupation = occupation;
    if (highestQualification) user.highestQualification = highestQualification;
    if (fieldOfStudy) user.fieldOfStudy = fieldOfStudy;
    if (skills) user.skills = skills;
    if (socialMedia) user.socialMedia = socialMedia;

    user.profileCompleted = true;
    user.registrationStep = 3;
    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user, client);

    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.emailOtp;
    delete userObj.emailOtpExpiry;
    delete userObj.mobileOtp;
    delete userObj.mobileOtpExpiry;

    res.json({
      success: true,
      message: 'Profile completed successfully. Registration complete!',
      data: {
        user: userObj,
        token,
        registrationStep: 3,
        registrationComplete: true,
        emailVerified: true,
        mobileVerified: true,
        profileCompleted: true,
        clientId: client.clientId,
      },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────

const loginUser = async (req, res) => {
  try {
    const { email, password, clientId } = req.body;
    if (!email || !password || !clientId)
      return res.status(400).json({ success: false, message: 'email, password and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    if (user.registrationStep < 3) {
      return res.status(403).json({
        success: false,
        message: 'Registration incomplete. Please complete all registration steps.',
        data: { registrationStep: user.registrationStep, emailVerified: user.emailVerified, mobileVerified: user.mobileVerified },
      });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user, client);
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.emailOtp;
    delete userObj.emailOtpExpiry;
    delete userObj.mobileOtp;
    delete userObj.mobileOtpExpiry;

    res.json({
      success: true,
      message: 'Login successful',
      data: { user: userObj, token, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── GOOGLE LOGIN / REGISTER ──────────────────────────────────────────────────

const googleAuth = async (req, res) => {
  try {
    const { credential, clientId } = req.body;
    if (!credential || !clientId)
      return res.status(400).json({ success: false, message: 'credential and clientId required' });

    const client = await validateClientId(clientId);

    const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
    const { email, name, picture, sub: googleId } = payload;

    let user = await MobileUser.findOne({ email, clientId: client._id });

    if (user && user.registrationStep === 3) {
      user.lastLoginAt = new Date();
      await user.save();
      const token = generateToken(user, client);
      const userObj = user.toObject();
      delete userObj.password;
      delete userObj.emailOtp;
      delete userObj.emailOtpExpiry;
      delete userObj.mobileOtp;
      delete userObj.mobileOtpExpiry;
      return res.json({
        success: true,
        registrationComplete: true,
        message: 'Login successful',
        data: { token, user: userObj, clientId: client.clientId },
      });
    }

    if (!user) {
      user = await MobileUser.create({
        email, name, googleId,
        googlePicture: picture,
        isGoogleUser: true,
        emailVerified: true,
        registrationStep: 1,
        clientId: client._id,
        clientCode: client.clientId,
      });
    } else {
      user.emailVerified = true;
      user.registrationStep = Math.max(user.registrationStep, 1);
      user.googleId = googleId;
      await user.save();
    }

    res.json({
      success: true,
      registrationComplete: false,
      message: 'Email verified with Google. Please continue with mobile verification (Step 2).',
      data: { email, emailVerified: true, registrationStep: 1, nextStep: 'mobile_verification', clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── CHECK EMAIL ──────────────────────────────────────────────────────────────

const checkEmail = async (req, res) => {
  try {
    const { email, clientId } = req.body;
    if (!email || !clientId)
      return res.status(400).json({ success: false, message: 'email and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });

    if (user && user.registrationStep === 3) {
      return res.json({
        success: true,
        message: 'User found',
        data: { registered: true, emailVerified: user.emailVerified, clientId: client.clientId },
      });
    }

    res.json({
      success: false,
      message: 'not registered',
      data: { registered: false, registrationStep: 1, nextStep: 'mobile_verification', clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── RESEND EMAIL OTP ─────────────────────────────────────────────────────────

const resendEmailOtp = async (req, res) => {
  try {
    const { email, clientId } = req.body;
    if (!email || !clientId)
      return res.status(400).json({ success: false, message: 'email and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const otp = generateOtp();
    user.emailOtp = otp;
    user.emailOtpExpiry = otpExpiry();
    await user.save();

    await sendEmailOtp(email, otp);

    res.json({ success: true, message: 'OTP resent to your email.' });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── RESEND MOBILE OTP ────────────────────────────────────────────────────────

const resendMobileOtp = async (req, res) => {
  try {
    const { mobile, otpMethod = 'whatsapp', clientId } = req.body;
    if (!mobile || !clientId)
      return res.status(400).json({ success: false, message: 'mobile and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ mobile, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.mobile) return res.status(400).json({ success: false, message: 'Mobile number not found. Please go to Step 2.' });

    const otp = generateOtp();
    user.mobileOtp = otp;
    user.mobileOtpExpiry = otpExpiry();
    user.otpMethod = otpMethod;
    await user.save();

    await sendMobileOtp(user.mobile, otp, otpMethod);

    res.json({ success: true, message: `OTP resent to your mobile via ${otpMethod.toUpperCase()}.` });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── FIREBASE REGISTER ────────────────────────────────────────────────────────

const firebaseRegister = async (req, res) => {
  try {
    const { idToken, clientId } = req.body;
    if (!idToken || !clientId)
      return res.status(400).json({ success: false, message: 'idToken and clientId required' });

    const client = await validateClientId(clientId);

    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    const { email, name, uid } = payload;

    let user = await MobileUser.findOne({ email, clientId: client._id });
    if (user && user.registrationStep === 3)
      return res.status(400).json({ success: false, message: 'Already registered. Please login.' });

    if (!user) {
      user = await MobileUser.create({
        email, name, firebaseUid: uid,
        isFirebaseUser: true,
        emailVerified: true,
        registrationStep: 1,
        clientId: client._id,
        clientCode: client.clientId,
      });
    } else {
      user.emailVerified = true;
      user.firebaseUid = uid;
      user.registrationStep = Math.max(user.registrationStep, 1);
      await user.save();
    }

    res.json({
      success: true,
      message: 'Firebase email verified. Please continue with mobile verification (Step 2).',
      data: { email, emailVerified: true, registrationStep: 1, nextStep: 'mobile_verification', clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── FIREBASE LOGIN ───────────────────────────────────────────────────────────

const firebaseLogin = async (req, res) => {
  try {
    const { idToken, clientId } = req.body;
    if (!idToken || !clientId)
      return res.status(400).json({ success: false, message: 'idToken and clientId required' });

    const client = await validateClientId(clientId);

    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    const { email } = payload;

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found. Please register.' });

    if (user.registrationStep < 3) {
      return res.status(403).json({
        success: false,
        message: 'Registration incomplete.',
        data: { registrationStep: user.registrationStep, emailVerified: user.emailVerified, mobileVerified: user.mobileVerified },
      });
    }

    user.lastLoginAt = new Date();
    await user.save();
    const token = generateToken(user, client);
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.emailOtp;
    delete userObj.emailOtpExpiry;
    delete userObj.mobileOtp;
    delete userObj.mobileOtpExpiry;

    res.json({
      success: true,
      message: 'Login successful',
      data: { user: userObj, token, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── GET PROFILE ──────────────────────────────────────────────────────────────

const getProfile = async (req, res) => {
  try {
    const user = await MobileUser.findById(req.user.id).select('-password -emailOtp -mobileOtp -emailOtpExpiry -mobileOtpExpiry');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: { user } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── UPDATE PROFILE ───────────────────────────────────────────────────────────

const updateProfile = async (req, res) => {
  try {
    const { name, mobileNumber, city, pincode, businessName, gender, ageRange, businessInterests, occupation, highestQualification, fieldOfStudy, skills, socialMedia } = req.body;
    const user = await MobileUser.findByIdAndUpdate(
      req.user.id,
      { name, mobileNumber, city, pincode, businessName, gender, ageRange, businessInterests, occupation, highestQualification, fieldOfStudy, skills, socialMedia },
      { new: true }
    ).select('-password -emailOtp -mobileOtp -emailOtpExpiry -mobileOtpExpiry');

    res.json({ success: true, message: 'Profile updated', data: { user } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── UPLOAD PROFILE PICTURE (Step 4) - R2 Presigned URL ─────────────────────
// Flow: Frontend calls this API → gets presigned URL → uploads directly to R2
//       → then calls /profile/image/confirm to save the key in DB

const getProfileImageUploadUrl = async (req, res) => {
  try {
    const { fileType } = req.body;
    // fileType: image/jpeg, image/png, image/webp
    if (!fileType) return res.status(400).json({ success: false, message: 'fileType is required' });

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowedTypes.includes(fileType))
      return res.status(400).json({ success: false, message: 'Invalid file type. Allowed: jpeg, png, webp' });

    const ext = fileType.split('/')[1];
    const key = `profile-images/${req.user.id}/${Date.now()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 }); // 5 min expiry

    res.json({
      success: true,
      message: 'Presigned URL generated. Upload image directly to this URL using PUT request.',
      data: {
        uploadUrl,
        key,
        expiresIn: 300,
        instructions: 'PUT request to uploadUrl with file binary in body and Content-Type header',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// After frontend uploads to R2, call this to save key in DB
const confirmProfileImage = async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ success: false, message: 'key is required' });

    // Build public URL
    const imageUrl = `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET}/${key}`;

    const user = await MobileUser.findByIdAndUpdate(
      req.user.id,
      { profileImageKey: key, profileImageUrl: imageUrl },
      { new: true }
    ).select('-password -emailOtp -mobileOtp -emailOtpExpiry -mobileOtpExpiry -resetOtp -resetOtpExpiry');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({
      success: true,
      message: 'Profile image updated successfully',
      data: { profileImageUrl: imageUrl, profileImageKey: key, user },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── FORGOT PASSWORD — Send Reset OTP to Email ────────────────────────────────

const forgotPassword = async (req, res) => {
  try {
    const { email, clientId } = req.body;
    if (!email || !clientId)
      return res.status(400).json({ success: false, message: 'email and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    // Always return success to prevent email enumeration attack
    if (!user || user.registrationStep < 3) {
      return res.json({ success: true, message: 'If this email is registered, an OTP has been sent.' });
    }

    const otp = generateOtp();
    user.resetOtp = otp;
    user.resetOtpExpiry = otpExpiry();
    user.resetOtpVerified = false;
    await user.save();

    // Send reset OTP via email
    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'App', email: process.env.BREVO_FROM_EMAIL },
        to: [{ email }],
        subject: 'Password Reset OTP',
        htmlContent: `<p>Your password reset OTP is <b>${otp}</b>. It is valid for 10 minutes.</p><p>If you did not request this, please ignore this email.</p>`,
      },
      { headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' } }
    );

    res.json({
      success: true,
      message: 'If this email is registered, an OTP has been sent.',
      data: { email, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── VERIFY RESET OTP ─────────────────────────────────────────────────────────

const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp, clientId } = req.body;
    if (!email || !otp || !clientId)
      return res.status(400).json({ success: false, message: 'email, otp and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.resetOtp)
      return res.status(400).json({ success: false, message: 'No OTP requested. Please request a new OTP.' });

    if (user.resetOtp !== otp)
      return res.status(400).json({ success: false, message: 'Invalid OTP' });

    if (user.resetOtpExpiry < new Date())
      return res.status(400).json({ success: false, message: 'OTP expired. Please resend.' });

    // Mark OTP as verified but don't clear it yet — needed for reset step
    user.resetOtpVerified = true;
    await user.save();

    res.json({
      success: true,
      message: 'OTP verified successfully. You can now reset your password.',
      data: { email, otpVerified: true, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────

const resetPassword = async (req, res) => {
  try {
    const { email, newPassword, clientId } = req.body;
    if (!email || !newPassword || !clientId)
      return res.status(400).json({ success: false, message: 'email, newPassword and clientId required' });

    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.resetOtpVerified)
      return res.status(400).json({ success: false, message: 'Please verify OTP first before resetting password.' });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    user.resetOtpVerified = false;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.',
      data: { email, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

// ─── RESEND RESET OTP ─────────────────────────────────────────────────────────

const resendResetOtp = async (req, res) => {
  try {
    const { email, clientId } = req.body;
    if (!email || !clientId)
      return res.status(400).json({ success: false, message: 'email and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user || user.registrationStep < 3)
      return res.json({ success: true, message: 'If this email is registered, an OTP has been sent.' });

    const otp = generateOtp();
    user.resetOtp = otp;
    user.resetOtpExpiry = otpExpiry();
    user.resetOtpVerified = false;
    await user.save();

    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'App', email: process.env.BREVO_FROM_EMAIL },
        to: [{ email }],
        subject: 'Password Reset OTP',
        htmlContent: `<p>Your new password reset OTP is <b>${otp}</b>. It is valid for 10 minutes.</p>`,
      },
      { headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' } }
    );

    res.json({ success: true, message: 'OTP resent to your email.' });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
  }
};

module.exports = {
  step1SendEmailOtp,
  step1VerifyEmailOtp,
  step2SendMobileOtp,
  step2VerifyMobileOtp,
  step3CompleteProfile,
  loginUser,
  googleAuth,
  checkEmail,
  resendEmailOtp,
  resendMobileOtp,
  firebaseRegister,
  firebaseLogin,
  getProfile,
  updateProfile,
  getProfileImageUploadUrl,
  confirmProfileImage,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  resendResetOtp,
};
