const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
  },
  password: {
    type: String,
    required: [true, "Password is required"],
  },
  businessName: {
    type: String,
    required: [true, "Business name is required"],
  },
  gstNo: {
    type: String,
    required: [true, "GST number is required"],
    unique: true,
  },
  panNo: {
    type: String,
    required: [true, "PAN number is required"],
    unique: true,
  },
  aadharNo: {
    type: String,
    required: [true, "Aadhar number is required"],
    unique: true,
  },
  city: {
    type: String,
    required: [true, "City is required"],
  },
  pincode: {
    type: String,
    required: [true, "Pincode is required"],
  },
  websiteUrl: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Client = mongoose.model("Client", clientSchema);

module.exports = Client;
