const Group = require('../models/group');
const UserProfile = require('../models/userProfile');

// Helper to generate groupId
function generateGroupId(interest, number) {
  return `${interest.toLowerCase().replace(/\s+/g, '-')}-${number}`;
}

// Add user to a group based on business interest
exports.joinGroup = async (req, res) => {
  try {
    const { email, name, groupInterest } = req.body;
    if (!email || !name || !groupInterest) {
      return res.status(400).json({ success: false, message: 'email, name, and groupInterest are required' });
    }

    // Find all groups for this interest, sorted by creation
    let groups = await Group.find({ groupInterest, isActive: true }).sort({ createdAt: 1 });
    let group = groups.find(g => g.numberOfMembers < 100 && !g.groupMembers.some(m => m.email === email));

    // If no available group, create a new one
    if (!group) {
      const groupNumber = groups.length + 1;
      const groupId = generateGroupId(groupInterest, groupNumber);
      group = new Group({
        groupId,
        groupInterest,
        isActive: true,
        numberOfMembers: 1,
        groupMembers: [{ email, name }]
      });
      await group.save();
    } else {
      // Add user if not already in group
      if (!group.groupMembers.some(m => m.email === email)) {
        group.groupMembers.push({ email, name });
        group.numberOfMembers = group.groupMembers.length;
        await group.save();
      }
    }
    return res.json({ success: true, group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get all groups
exports.getAllGroups = async (req, res) => {
  try {
    const groups = await Group.find();
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get groups by interest
exports.getGroupsByInterest = async (req, res) => {
  try {
    const { interest } = req.params;
    const groups = await Group.find({ groupInterest: interest });
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get groups for a user
exports.getGroupsForUser = async (req, res) => {
  try {
    const { email } = req.params;
    const groups = await Group.find({ 'groupMembers.email': email });
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
}; 