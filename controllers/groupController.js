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

    // Check if user is already in any group for this interest
    let userGroup = groups.find(g => g.groupMembers.some(m => m.email === email));
    if (userGroup) {
      // User is already in a group for this interest, return that group
      return res.json({ success: true, group: userGroup });
    }

    // Find a group with less than 100 members
    let availableGroup = groups.find(g => g.numberOfMembers < 100);

    if (availableGroup) {
      // Add user to this group
      availableGroup.groupMembers.push({ email, name });
      availableGroup.numberOfMembers = availableGroup.groupMembers.length;
      await availableGroup.save();
      return res.json({ success: true, group: availableGroup });
    } else {
      // No available group, create a new one
      const groupNumber = groups.length + 1;
      const groupId = generateGroupId(groupInterest, groupNumber);
      let newGroup = new Group({
        groupId,
        groupInterest,
        isActive: false,
        numberOfMembers: 1,
        groupMembers: [{ email, name }]
      });
      await newGroup.save();
      return res.json({ success: true, group: newGroup });
    }
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