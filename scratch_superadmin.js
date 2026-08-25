require('dotenv').config();
const mongoose = require('mongoose');
const Superadmin = require('./models/superadmin');

async function checkSuperadmins() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to DB");
    
    const superadmins = await Superadmin.find({});
    console.log("Superadmins in DB:");
    superadmins.forEach(sa => {
      console.log(`Name: ${sa.name}, Email: ${sa.email}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.disconnect();
  }
}

checkSuperadmins();
