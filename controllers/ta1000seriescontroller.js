const TA1000Series = require('../models/TA1000Series');

exports.createTA1000Series = async (req, res) => {
  try {
    const ta1000 = new TA1000Series(req.body);
    await ta1000.save();
    res.status(201).json(ta1000);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllTA1000Series = async (req, res) => {
  try {
    const all = await TA1000Series.find();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTA1000SeriesById = async (req, res) => {
  try {
    const ta1000 = await TA1000Series.findById(req.params.id);
    if (!ta1000) return res.status(404).json({ error: 'Not found' });
    res.json(ta1000);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateTA1000Series = async (req, res) => {
  try {
    const ta1000 = await TA1000Series.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!ta1000) return res.status(404).json({ error: 'Not found' });
    res.json(ta1000);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteTA1000Series = async (req, res) => {
  try {
    const ta1000 = await TA1000Series.findByIdAndDelete(req.params.id);
    if (!ta1000) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}; 