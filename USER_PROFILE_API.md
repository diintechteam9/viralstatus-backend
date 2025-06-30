# User Profile API Documentation

## Overview

This API provides comprehensive user profile management for influencer profiles with detailed personal information, business interests, education, skills, and social media details.

## Base URL

```
http://localhost:4000/api/user-profiles
```

## Endpoints

### 1. Create User Profile

**POST** `/api/user-profiles`

Creates a new user profile with all required and optional fields.

**Request Body:**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "mobileNumber": "+1234567890",
  "city": "Mumbai",
  "gender": "Male",
  "ageRange": "25-34",
  "businessInterests": [
    "Fashion & Lifestyle",
    "Beauty & Cosmetics",
    "Health & Wellness"
  ],
  "otherBusinessInterest": "Custom interest",
  "occupation": "Content Creator (Full-Time)",
  "otherOccupation": "Custom occupation",
  "highestQualification": "Bachelor's Degree",
  "fieldOfStudy": "Computer Science",
  "institutionName": "University of Mumbai",
  "skills": ["Content Creation", "Video Editing", "Photography"],
  "otherSkills": "Custom skills",
  "socialMedia": {
    "instagram": {
      "handle": "@johndoe",
      "followersCount": 10000
    },
    "youtube": {
      "channelUrl": "https://youtube.com/@johndoe",
      "subscribers": 5000
    },
    "twitter": {
      "handle": "@johndoe",
      "followers": 3000
    },
    "linkedin": {
      "profileUrl": "https://linkedin.com/in/johndoe",
      "connections": 500
    },
    "pinterest": {
      "profileUrl": "https://pinterest.com/johndoe",
      "followers": 2000
    },
    "snapchat": {
      "username": "johndoe"
    },
    "website": {
      "url": "https://johndoe.com"
    }
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "User profile created successfully",
  "userProfile": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "mobileNumber": "+1234567890",
    "city": "Mumbai",
    "gender": "Male",
    "ageRange": "25-34",
    "businessInterests": [
      "Fashion & Lifestyle",
      "Beauty & Cosmetics",
      "Health & Wellness"
    ],
    "otherBusinessInterest": "Custom interest",
    "occupation": "Content Creator (Full-Time)",
    "otherOccupation": "Custom occupation",
    "highestQualification": "Bachelor's Degree",
    "fieldOfStudy": "Computer Science",
    "institutionName": "University of Mumbai",
    "skills": ["Content Creation", "Video Editing", "Photography"],
    "otherSkills": "Custom skills",
    "socialMedia": {
      "instagram": {
        "handle": "@johndoe",
        "followersCount": 10000
      },
      "youtube": {
        "channelUrl": "https://youtube.com/@johndoe",
        "subscribers": 5000
      }
    },
    "isProfileCompleted": true,
    "isVerified": false,
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 2. Get All User Profiles

**GET** `/api/user-profiles`

Retrieves all user profiles with filtering and pagination.

**Query Parameters:**

- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `city` (optional): Filter by city
- `businessInterests` (optional): Filter by business interests (comma-separated)
- `occupation` (optional): Filter by occupation
- `isVerified` (optional): Filter by verification status (true/false)
- `isActive` (optional): Filter by active status (true/false)
- `search` (optional): Search in name, email, city

**Example Requests:**

```
GET /api/user-profiles
GET /api/user-profiles?page=1&limit=10
GET /api/user-profiles?city=Mumbai&isVerified=true
GET /api/user-profiles?businessInterests=Fashion & Lifestyle,Beauty & Cosmetics
GET /api/user-profiles?search=john
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "John Doe",
      "email": "john@example.com",
      "city": "Mumbai",
      "occupation": "Content Creator (Full-Time)",
      "isVerified": true,
      "isActive": true
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalProfiles": 50,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### 3. Get Profile Statistics

**GET** `/api/user-profiles/stats`

Retrieves comprehensive statistics about user profiles.

**Response:**

```json
{
  "success": true,
  "stats": {
    "totalProfiles": 100,
    "verifiedProfiles": 75,
    "activeProfiles": 90,
    "completedProfiles": 85,
    "verificationRate": "75.00",
    "completionRate": "85.00"
  },
  "topCities": [
    { "_id": "Mumbai", "count": 25 },
    { "_id": "Delhi", "count": 20 },
    { "_id": "Bangalore", "count": 15 }
  ],
  "topBusinessInterests": [
    { "_id": "Fashion & Lifestyle", "count": 30 },
    { "_id": "Beauty & Cosmetics", "count": 25 },
    { "_id": "Health & Wellness", "count": 20 }
  ],
  "topOccupations": [
    { "_id": "Content Creator (Full-Time)", "count": 35 },
    { "_id": "Student", "count": 20 },
    { "_id": "Freelancer", "count": 15 }
  ]
}
```

### 4. Get User Profile by ID

**GET** `/api/user-profiles/:id`

Retrieves a specific user profile by ID.

**Example:**

```
GET /api/user-profiles/507f1f77bcf86cd799439011
```

**Response:**

```json
{
  "success": true,
  "userProfile": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "mobileNumber": "+1234567890",
    "city": "Mumbai",
    "gender": "Male",
    "ageRange": "25-34",
    "businessInterests": ["Fashion & Lifestyle", "Beauty & Cosmetics"],
    "occupation": "Content Creator (Full-Time)",
    "highestQualification": "Bachelor's Degree",
    "fieldOfStudy": "Computer Science",
    "skills": ["Content Creation", "Video Editing"],
    "socialMedia": {
      "instagram": {
        "handle": "@johndoe",
        "followersCount": 10000
      }
    },
    "isProfileCompleted": true,
    "isVerified": false,
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 5. Get User Profile by Email

**GET** `/api/user-profiles/email/:email`

Retrieves a specific user profile by email.

**Example:**

```
GET /api/user-profiles/email/john@example.com
```

### 6. Update User Profile

**PUT** `/api/user-profiles/:id`

Updates an existing user profile.

**Example:**

```
PUT /api/user-profiles/507f1f77bcf86cd799439011
```

**Request Body:**

```json
{
  "name": "John Updated",
  "city": "Delhi",
  "businessInterests": ["Tech & Gadgets", "Finance & Investing"]
}
```

**Response:**

```json
{
  "success": true,
  "message": "User profile updated successfully",
  "userProfile": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Updated",
    "city": "Delhi",
    "businessInterests": ["Tech & Gadgets", "Finance & Investing"],
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 7. Delete User Profile

**DELETE** `/api/user-profiles/:id`

Deletes a user profile.

**Example:**

```
DELETE /api/user-profiles/507f1f77bcf86cd799439011
```

**Response:**

```json
{
  "success": true,
  "message": "User profile deleted successfully"
}
```

### 8. Verify User Profile

**PATCH** `/api/user-profiles/:id/verify`

Verifies or unverifies a user profile (admin function).

**Example:**

```
PATCH /api/user-profiles/507f1f77bcf86cd799439011/verify
```

**Request Body:**

```json
{
  "isVerified": true
}
```

**Response:**

```json
{
  "success": true,
  "message": "User profile verified successfully",
  "userProfile": {
    "_id": "507f1f77bcf86cd799439011",
    "isVerified": true
  }
}
```

## Field Options

### Gender Options

- Male
- Female
- Other
- Prefer not to say

### Age Range Options

- 18-24
- 25-34
- 35-44
- 45-54
- 55+

### Business Interests Options

- Fashion & Lifestyle
- Beauty & Cosmetics
- Health & Wellness
- Travel & Tourism
- Food & Beverages
- Tech & Gadgets
- Finance & Investing
- Parenting & Family
- Education & EdTech
- Gaming & eSports
- Fitness & Sports
- Music & Entertainment
- Luxury & Automobiles
- Environment & Sustainability
- Startups & Entrepreneurship
- Books & Literature
- Home Decor & Interiors
- Pet Care
- Non-Profit & Social Causes

### Occupation Options

- Student
- Freelancer
- Content Creator (Full-Time)
- Actor/Performer
- Model
- Entrepreneur
- Corporate Professional
- Photographer/Videographer
- Journalist/Blogger
- Artist/Designer
- Public Speaker/Coach
- Fitness Trainer
- Healthcare Professional

### Education Options

- High School
- Diploma
- Bachelor's Degree
- Master's Degree
- Doctorate
- Other

### Skills Options

- Content Creation
- Video Editing
- Photography
- Public Speaking
- Graphic Design
- Social Media Strategy
- Writing/Copywriting
- Brand Promotion
- SEO/Hashtag Strategy
- Storytelling
- Live Streaming
- Voice Over
- Community Engagement

## Testing with Postman

### 1. Test Create Profile

```
POST http://localhost:4000/api/user-profiles
Content-Type: application/json

{
  "name": "Test User",
  "email": "test@example.com",
  "mobileNumber": "+1234567890",
  "city": "Mumbai",
  "gender": "Male",
  "ageRange": "25-34",
  "businessInterests": ["Fashion & Lifestyle"],
  "occupation": "Content Creator (Full-Time)",
  "highestQualification": "Bachelor's Degree",
  "fieldOfStudy": "Computer Science",
  "skills": ["Content Creation"]
}
```

### 2. Test Get All Profiles

```
GET http://localhost:4000/api/user-profiles
```

### 3. Test Get Stats

```
GET http://localhost:4000/api/user-profiles/stats
```

### 4. Test Update Profile

```
PUT http://localhost:4000/api/user-profiles/PROFILE_ID
Content-Type: application/json

{
  "name": "Updated Name",
  "city": "Delhi"
}
```

## Error Responses

### 400 Bad Request

```json
{
  "success": false,
  "message": "User profile with this email already exists"
}
```

### 404 Not Found

```json
{
  "success": false,
  "message": "User profile not found"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "An error occurred while creating user profile"
}
```

## Notes

- All email addresses are automatically converted to lowercase
- Business interests and skills can be multiple selections
- Social media fields are optional
- Profile completion status is automatically set to true when profile is created
- Verification status is managed by admins
- All timestamps are automatically managed
