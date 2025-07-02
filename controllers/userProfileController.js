const UserProfile = require("../models/userProfile");
const Client = require("../models/client");
const Group = require('../models/group');

/**
 * Create a new user profile
 */
const createUserProfile = async (req, res) => {
  try {
    const {
      name,
      email,
      mobileNumber,
      city,
      pincode,
      businessName,
      gender,
      ageRange,
      businessInterests,
      otherBusinessInterest,
      occupation,
      highestQualification,
      fieldOfStudy,
      skills,
      otherSkills,
      socialMedia
    } = req.body;

    // Use authenticated user's email if available, otherwise use provided email
    const userEmail = req.user?.email || email;

    // Get client details for auto-population
    let clientDetails = req.clientDetails;
    if (!clientDetails && req.client?.id) {
      try {
        const client = await Client.findById(req.client.id).select('name businessName city pincode');
        if (client) {
          clientDetails = {
            name: client.name,
            businessName: client.businessName,
            city: client.city,
            pincode: client.pincode
          };
        }
      } catch (dbError) {
        console.error('Error fetching client details in create:', dbError);
      }
    }

    // Check if user profile already exists with this email
    const existingProfile = await UserProfile.findOne({ email: userEmail });
    if (existingProfile) {
      return res.status(400).json({
        success: false,
        message: "User profile with this email already exists"
      });
    }

    // Check if all required fields are filled
    const requiredFields = [name, userEmail, mobileNumber, city, pincode, businessName, gender, ageRange, occupation, highestQualification];
    const isProfileCompleted = requiredFields.every(field => field && field.trim() !== '');

    // Create new user profile with request body prioritized, fallback to clientDetails if missing
    const userProfile = await UserProfile.create({
      name: name || clientDetails?.name || "",
      email: userEmail,
      mobileNumber,
      city: city || clientDetails?.city || "",
      pincode: pincode || clientDetails?.pincode || "",
      businessName: businessName || clientDetails?.businessName || "",
      gender,
      ageRange,
      businessInterests,
      otherBusinessInterest,
      occupation,
      highestQualification,
      fieldOfStudy,
      skills,
      otherSkills,
      socialMedia,
      isProfileCompleted
    });

    // Automatically add user to groups for each business interest
    if (Array.isArray(businessInterests)) {
      for (const interest of businessInterests) {
        // Find all groups for this interest, sorted by creation
        let groups = await Group.find({ groupInterest: interest, isActive: true }).sort({ createdAt: 1 });
        let group = groups.find(g => g.numberOfMembers < 100 && !g.groupMembers.some(m => m.email === userEmail));
        // If no available group, create a new one
        if (!group) {
          const groupNumber = groups.length + 1;
          const groupId = `${interest.toLowerCase().replace(/\s+/g, '-')}-${groupNumber}`;
          group = new Group({
            groupId,
            groupInterest: interest,
            isActive: true,
            numberOfMembers: 1,
            groupMembers: [{ email: userEmail, name: userProfile.name }]
          });
          await group.save();
        } else {
          // Add user if not already in group
          if (!group.groupMembers.some(m => m.email === userEmail)) {
            group.groupMembers.push({ email: userEmail, name: userProfile.name });
            group.numberOfMembers = group.groupMembers.length;
            await group.save();
          }
        }
      }
    }

    // After creating the user profile, sync isProfileCompleted to Client if true
    if (isProfileCompleted && userEmail) {
      await Client.findOneAndUpdate(
        { email: userEmail },
        { isProfileCompleted: true }
      );
    }

    res.status(201).json({
      success: true,
      message: "User profile created successfully",
      userProfile
    });

  } catch (error) {
    console.error('Create user profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while creating user profile"
    });
  }
};

/**
 * Get all user profiles with filtering and pagination
 */
const getAllUserProfiles = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      city,
      businessInterests,
      occupation,
      isVerified,
      isActive,
      search
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (city) filter.city = { $regex: city, $options: 'i' };
    if (businessInterests) filter.businessInterests = { $in: businessInterests.split(',') };
    if (occupation) filter.occupation = occupation;
    if (isVerified !== undefined) filter.isVerified = isVerified === 'true';
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get profiles with pagination
    const userProfiles = await UserProfile.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalProfiles = await UserProfile.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: userProfiles,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalProfiles / parseInt(limit)),
        totalProfiles,
        hasNextPage: skip + userProfiles.length < totalProfiles,
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Get all user profiles error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while fetching user profiles"
    });
  }
};

/**
 * Get user profile by ID
 */
const getUserProfileById = async (req, res) => {
  try {
    const { id } = req.params;

    const userProfile = await UserProfile.findById(id);
    
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: "User profile not found"
      });
    }

    res.status(200).json({
      success: true,
      userProfile
    });

  } catch (error) {
    console.error('Get user profile by ID error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while fetching user profile"
    });
  }
};

/**
 * Get user profile by email
 */
const getUserProfileByEmail = async (req, res) => {
  try {
    const { email } = req.params;

    const userProfile = await UserProfile.findOne({ email });
    
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: "User profile not found"
      });
    }

    res.status(200).json({
      success: true,
      userProfile
    });

  } catch (error) {
    console.error('Get user profile by email error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while fetching user profile"
    });
  }
};

/**
 * Get current user's profile
 */
const getCurrentUserProfile = async (req, res) => {
  try {
    // Get user email from the authenticated user (assuming it's in req.user)
    let userEmail = req.user?.email;
    
    // If no email in req.user, try to fetch from database using client ID
    if (!userEmail && req.client?.id) {
      try {
        const client = await Client.findById(req.client.id).select('email name businessName city pincode');
        if (client) {
          userEmail = client.email;
        }
      } catch (dbError) {
        console.error('Error fetching client email in controller:', dbError);
      }
    }
    
    if (!userEmail) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated or email not found"
      });
    }

    const userProfile = await UserProfile.findOne({ email: userEmail });
    
    if (!userProfile) {
      // Get client details for auto-population
      let clientDetails = req.clientDetails;
      if (!clientDetails && req.client?.id) {
        try {
          const client = await Client.findById(req.client.id).select('name businessName city pincode');
          if (client) {
            clientDetails = {
              name: client.name,
              businessName: client.businessName,
              city: client.city,
              pincode: client.pincode
            };
          }
        } catch (dbError) {
          console.error('Error fetching client details in controller:', dbError);
        }
      }
      
      // Return empty profile structure for new users with auto-populated fields
      return res.status(200).json({
        success: true,
        userProfile: {
          name: clientDetails?.name || "",
          email: userEmail,
          mobileNumber: "",
          city: clientDetails?.city || "",
          pincode: clientDetails?.pincode || "",
          businessName: clientDetails?.businessName || "",
          gender: "",
          ageRange: "",
          businessInterests: [],
          occupation: "",
          highestQualification: "",
          fieldOfStudy: "",
          skills: [],
          socialMedia: {
            instagram: {
              handle: "",
              followersCount: ""
            },
            youtube: {
              channelUrl: "",
              subscribers: ""
            }
          }
        }
      });
    }

    res.status(200).json({
      success: true,
      userProfile
    });

  } catch (error) {
    console.error('Get current user profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while fetching user profile"
    });
  }
};

/**
 * Update user profile
 */
const updateUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated
    delete updateData._id;
    delete updateData.createdAt;

    // Check if all required fields are filled after update
    const requiredFields = [
      updateData.name || req.body.name,
      updateData.email || req.body.email,
      updateData.mobileNumber || req.body.mobileNumber,
      updateData.city || req.body.city,
      updateData.gender || req.body.gender,
      updateData.ageRange || req.body.ageRange,
      updateData.occupation || req.body.occupation,
      updateData.highestQualification || req.body.highestQualification
    ];
    
    const isProfileCompleted = requiredFields.every(field => field && field.trim() !== '');
    updateData.isProfileCompleted = isProfileCompleted;

    const updatedProfile = await UserProfile.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedProfile) {
      return res.status(404).json({
        success: false,
        message: "User profile not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "User profile updated successfully",
      userProfile: updatedProfile
    });

  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while updating user profile"
    });
  }
};

/**
 * Delete user profile
 */
const deleteUserProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedProfile = await UserProfile.findByIdAndDelete(id);

    if (!deletedProfile) {
      return res.status(404).json({
        success: false,
        message: "User profile not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "User profile deleted successfully"
    });

  } catch (error) {
    console.error('Delete user profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while deleting user profile"
    });
  }
};

/**
 * Verify user profile (admin function)
 */
const verifyUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { isVerified } = req.body;

    const updatedProfile = await UserProfile.findByIdAndUpdate(
      id,
      { isVerified },
      { new: true }
    );

    if (!updatedProfile) {
      return res.status(404).json({
        success: false,
        message: "User profile not found"
      });
    }

    res.status(200).json({
      success: true,
      message: `User profile ${isVerified ? 'verified' : 'unverified'} successfully`,
      userProfile: updatedProfile
    });

  } catch (error) {
    console.error('Verify user profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while verifying user profile"
    });
  }
};

/**
 * Get profile statistics
 */
const getProfileStats = async (req, res) => {
  try {
    const totalProfiles = await UserProfile.countDocuments();
    const verifiedProfiles = await UserProfile.countDocuments({ isVerified: true });
    const activeProfiles = await UserProfile.countDocuments({ isActive: true });
    const completedProfiles = await UserProfile.countDocuments({ isProfileCompleted: true });

    // Get top cities
    const topCities = await UserProfile.aggregate([
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // Get top business interests
    const topBusinessInterests = await UserProfile.aggregate([
      { $unwind: '$businessInterests' },
      { $group: { _id: '$businessInterests', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // Get top occupations
    const topOccupations = await UserProfile.aggregate([
      { $group: { _id: '$occupation', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.status(200).json({
      success: true,
      stats: {
        totalProfiles,
        verifiedProfiles,
        activeProfiles,
        completedProfiles,
        verificationRate: totalProfiles > 0 ? (verifiedProfiles / totalProfiles * 100).toFixed(2) : 0,
        completionRate: totalProfiles > 0 ? (completedProfiles / totalProfiles * 100).toFixed(2) : 0
      },
      topCities,
      topBusinessInterests,
      topOccupations
    });

  } catch (error) {
    console.error('Get profile stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred while fetching profile statistics"
    });
  }
};

module.exports = {
  createUserProfile,
  getAllUserProfiles,
  getUserProfileById,
  getUserProfileByEmail,
  getCurrentUserProfile,
  updateUserProfile,
  deleteUserProfile,
  verifyUserProfile,
  getProfileStats
}; 