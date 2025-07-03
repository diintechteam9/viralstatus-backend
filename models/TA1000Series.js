const mongoose = require('mongoose');

const TA1000SeriesSchema = new mongoose.Schema({
  images: { type: Number, required: true },
  music: { type: Number, required: true },
  transition: { type: String, required: true },
  totalDuration: { type: Number, required: true }
});

module.exports = mongoose.model('TA1000Series', TA1000SeriesSchema); 