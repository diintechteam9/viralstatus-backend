const MobileUser = require('../models/MobileUser');
const Client = require('../models/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

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
  const message = `Your OTP is ${otp}. Valid for 10 minutes.`;

  if (method === 'gupshup') {
    const number = mobile.replace('+', '');
    await axios.get('https://enterprise.smsgupshup.com/GatewayAPI/rest', {
      params: {
        method: 'SendMessage',
        send_to: number,
        msg: message,
        msg_type: 'TEXT',
        userid: process.env.GUPSHUP_USERID,
        auth_scheme: 'plain',
        password: process.env.GUPSHUP_PASSWORD,
        v: '1.1',
        format: 'text',
        mask: process.env.GUPSHUP_MASK || 'MOBISL',
      },
    });
  } else if (method === 'twilio') {
    const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    await twilio.messages.create({ body: message, from: process.env.TWILIO_NUMBER, to: mobile });
  } else if (method === 'whatsapp') {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: mobile.replace('+', ''),
        type: 'template',
        template: {
          name: 'otp_verification',
          language: { code: 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: otp }] }],
        },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
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
    const { email, mobile, otpMethod = 'gupshup', clientId } = req.body;
    if (!email || !mobile || !clientId)
      return res.status(400).json({ success: false, message: 'email, mobile and clientId required' });

    const client = await validateClientId(clientId);

    const user = await MobileUser.findOne({ email, clientId: client._id });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.emailVerified) return res.status(400).json({ success: false, message: 'Please verify email first (Step 1)' });

    const otp = generateOtp();
    user.mobile = mobile;
    user.mobileOtp = otp;
    user.mobileOtpExpiry = otpExpiry();
    user.otpMethod = otpMethod;
    await user.save();

    await sendMobileOtp(mobile, otp, otpMethod);

    res.json({
      success: true,
      message: `OTP sent to your mobile via ${otpMethod.toUpperCase()}. Please verify to continue.`,
      data: { email, mobile, otpMethod, registrationStep: 2, clientId: client.clientId },
    });
  } catch (err) {
    res.status(err.message.includes('Client') ? 400 : 500).json({ success: false, message: err.message });
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

    if (user.mobileOtp !== otp)
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
    const { mobile, otpMethod = 'gupshup', clientId } = req.body;
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
};
