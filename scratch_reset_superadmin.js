require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Superadmin = require('./models/superadmin');

async function resetPassword() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to DB");
    
    const email = "superadmin@gmail.com";
    const newPassword = "Admin@123";
    const salt = await bcrypt.genSalt(10);
    const hashpassword = await bcrypt.hash(newPassword, salt);
    
    await Superadmin.updateOne({ email }, { password: hashpassword });
    console.log(`Password for ${email} has been reset to: ${newPassword}`);
    
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.disconnect();
  }
}

resetPassword();
