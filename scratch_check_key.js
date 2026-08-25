require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./models/client');

async function checkKey() {
  const keyToFind = "ce53b60bcf5042f86fb364bbedccc9dd";
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to DB");
    
    const client = await Client.findOne({ clientKey: keyToFind });
    if (client) {
      console.log(`Key found! It belongs to client: ${client.email} (${client.name})`);
      console.log(`Key is ACTIVE and WORKING.`);
    } else {
      console.log("Key not found in the database. It is NOT WORKING or might have been deleted/regenerated.");
    }
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.disconnect();
  }
}

checkKey();
