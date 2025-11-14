const Message = require('../../models/whatsapp/message');

// Save a message (sent or received)
const saveMessage = async (req, res) => {
  try {
    const { waID, direction, type, text, mediaType, mediaUrl, messageId, status, timestamp } = req.body;
    if (!waID || !direction) {
      return res.status(400).json({ error: 'waID and direction are required' });
    }
    const doc = await Message.create({
      waID,
      direction,
      type,
      text,
      mediaType,
      mediaUrl,
      messageId,
      status,
      timestamp: timestamp ? new Date(timestamp) : Date.now()
    });
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Get chat history for a waID
const getMessagesByWaID = async (req, res) => {
  try {
    const { waID } = req.params;
    // Remove + prefix to match database format (both sent and received messages now saved without +)
    const normalized = waID.startsWith('+') ? waID.substring(1) : waID;
    const list = await Message.find({ waID: normalized }).sort({ createdAt: 1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } 
};

// Debug function to get all messages (for testing)
const getAllMessages = async (req, res) => {
  try {
    const allMessages = await Message.find({}).sort({ createdAt: -1 }).limit(20);
    console.log('All messages in database:', allMessages.length);
    console.log('Sample messages:', allMessages.map(m => ({ waID: m.waID, direction: m.direction, text: m.text?.substring(0, 20) })));
    res.json(allMessages);
  } catch (err) 
  {
    console.error('Error getting all messages:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { saveMessage, getMessagesByWaID, getAllMessages };