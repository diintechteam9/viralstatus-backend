const ReelsTutorial = require('../models/ReelsTutorial');

exports.listTutorials = async (req, res) => {
  try {
    const { clientId, category } = req.query;
    const filter = { isActive: true };
    if (clientId) filter.clientId = clientId;
    if (category) filter.category = category;

    const tutorials = await ReelsTutorial.find(filter).sort({ order: 1, createdAt: -1 }).lean();
    res.json({ success: true, tutorials });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createTutorial = async (req, res) => {
  try {
    const { clientId, title, category, description, videoUrl, steps, order, isActive } = req.body;
    if (!clientId || !title?.trim()) {
      return res.status(400).json({ success: false, message: 'clientId and title required' });
    }
    const tutorial = await ReelsTutorial.create({
      clientId,
      title: title.trim(),
      category: category || 'reels',
      description: description || '',
      videoUrl: videoUrl || '',
      steps: Array.isArray(steps) ? steps.filter(Boolean) : [],
      order: order ?? 0,
      isActive: isActive !== false,
    });
    res.json({ success: true, tutorial });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateTutorial = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['title', 'category', 'description', 'videoUrl', 'steps', 'order', 'isActive'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const tutorial = await ReelsTutorial.findByIdAndUpdate(id, update, { new: true });
    if (!tutorial) return res.status(404).json({ success: false, message: 'Tutorial not found' });
    res.json({ success: true, tutorial });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteTutorial = async (req, res) => {
  try {
    const { id } = req.params;
    const tutorial = await ReelsTutorial.findByIdAndDelete(id);
    if (!tutorial) return res.status(404).json({ success: false, message: 'Tutorial not found' });
    res.json({ success: true, message: 'Tutorial deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
