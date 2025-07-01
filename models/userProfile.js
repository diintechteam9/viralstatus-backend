const mongoose = require("mongoose");

const userProfileSchema = new mongoose.Schema({
  // Basic Personal Details (Auto-populated from client, read-only)
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
    immutable: true // Makes this field read-only
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
    trim: true,
    immutable: true // Makes this field read-only
  },
  mobileNumber: {
    type: String,
    trim: true,
    default: ""
  },
  city: {
    type: String,
    trim: true,
    immutable: true, // Makes this field read-only
    default: ""
  },
  pincode: {
    type: String,
    trim: true,
    immutable: true, // Makes this field read-only
    default: ""
  },
  businessName: {
    type: String,
    trim: true,
    immutable: true, // Makes this field read-only
    default: ""
  },
  gender: {
    type: String,
    default: ""
  },
  ageRange: {
    type: String,
    enum: ["", "18-24", "25-34", "35-44", "45-54", "55+"],
    default: ""
  },

  // Business Interests (Multiple selection)
  businessInterests: [{
    type: String,
    enum: [
      'Fashion & Lifestyle',
      'Beauty & Cosmetics',
      'Health & Wellness',
      'Travel & Tourism',
      'Food & Beverages',
      'Tech & Gadgets',
      'Finance & Investing',
      'Parenting & Family',
      'Education & EdTech',
      'Gaming & eSports',
      'Fitness & Sports',
      'Music & Entertainment',
      'Luxury & Automobiles',
      'Environment & Sustainability',
      'Startups & Entrepreneurship',
      'Books & Literature',
      'Home Decor & Interiors',
      'Pet Care',
      'Non-Profit & Social Causes'
    ],
    default: undefined
  }],
  otherBusinessInterest: {
    type: String,
    trim: true,
    default: ""
  },

  // Occupation
  occupation: {
    type: String,
    enum: [
      "",
      'Student',
      'Freelancer',
      'Content Creator (Full-Time)',
      'Actor/Performer',
      'Model',
      'Entrepreneur',
      'Corporate Professional',
      'Photographer/Videographer',
      'Journalist/Blogger',
      'Artist/Designer',
      'Public Speaker/Coach',
      'Fitness Trainer',
      'Healthcare Professional'
    ],
    default: ""
  },

  // Education
  highestQualification: {
    type: String,
    enum: ["",'High School', 'Diploma', 'Bachelor\'s Degree', 'Master\'s Degree', 'Doctorate', 'Other'],
    default: ""
  },
  fieldOfStudy: {
    type: String,
    trim: true,
    default: ""
  },

  // Skills (Multiple selection)
  skills: [{
    type: String,
    enum: [
      "",
      'Content Creation',
      'Video Editing',
      'Photography',
      'Public Speaking',
      'Graphic Design',
      'Social Media Strategy',
      'Writing/Copywriting',
      'Brand Promotion',
      'SEO/Hashtag Strategy',
      'Storytelling',
      'Live Streaming',
      'Voice Over',
      'Community Engagement'
    ],
    default: undefined
  }],
  otherSkills: {
    type: String,
    trim: true,
    default: ""
  },

  // Social Media Profiles
  socialMedia: {
    instagram: {
      handle: {
        type: String,
        trim: true,
        default: ""
      },
      followersCount: {
        type: Number,
        min: 0,
        default: 0
      }
    },
    youtube: {
      channelUrl: {
        type: String,
        trim: true,
        default: ""
      },
      subscribers: {
        type: Number,
        min: 0,
        default: 0
      }
    },
    twitter: {
      handle: {
        type: String,
        trim: true,
        default: ""
      },
      followers: {
        type: Number,
        min: 0,
        default: 0
      }
    },
    linkedin: {
      profileUrl: {
        type: String,
        trim: true,
        default: ""
      },
      connections: {
        type: Number,
        min: 0,
        default: 0
      }
    },
    pinterest: {
      profileUrl: {
        type: String,
        trim: true,
        default: ""
      },
      followers: {
        type: Number,
        min: 0,
        default: 0
      }
    },
    snapchat: {
      username: {
        type: String,
        trim: true,
        default: ""
      }
    },
    website: {
      url: {
        type: String,
        trim: true,
        default: ""
      }
    }
  },

  // Profile Status
  isProfileCompleted: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
userProfileSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for efficient queries
userProfileSchema.index({ email: 1 });
userProfileSchema.index({ city: 1 });
userProfileSchema.index({ businessInterests: 1 });
userProfileSchema.index({ occupation: 1 });
userProfileSchema.index({ isActive: 1 });
userProfileSchema.index({ isVerified: 1 });

const UserProfile = mongoose.model("UserProfile", userProfileSchema);

module.exports = UserProfile; 