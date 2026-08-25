# Campaign API Documentation

Base URL: `https://app.yovoai.com/api/campaign`

---

## Authentication

Most endpoints require JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

Roles: `client`, `admin`, `super_admin`, `mobileuser`

---

## 1. Create Campaign

**POST** `/api/campaign/`

**Auth:** Required — `client`, `admin`, `super_admin`

**Content-Type:** `multipart/form-data`

### Request Body (Form Data)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| campaignName | string | ✅ | Name of the campaign |
| brandName | string | ✅ | Brand name |
| goal | string | ✅ | Campaign goal/objective |
| clientId | string | ✅ | MongoDB Client `_id` or `CLI-XXXXX` format |
| description | string | ✅ | Campaign description |
| startDate | date | ✅ | Campaign start date (ISO format) |
| endDate | date | ✅ | Campaign end date (ISO format) |
| location | string | ✅ | Target location (e.g., Delhi, India) |
| image | file | ✅ | Main campaign image (max 5MB) |
| categoryImage | file | ❌ | Category image (optional) |
| brandImage | file | ❌ | Brand logo image (optional) |
| credits | number | ❌ | Credits per task completion |
| cutoff | number | ❌ | Minimum views cutoff |
| limit | number | ❌ | Target number of participants |
| views | number | ❌ | Target views |
| tags | string/array | ❌ | Comma-separated tags or array |
| groupIds | string/array | ❌ | Comma-separated group IDs or array |
| tNc | string | ❌ | Terms and conditions |
| status | string | ❌ | `Active` or `Inactive` (default: `Active`) |
| category | string | ❌ | Campaign category |
| campaignType | string | ❌ | `public` or `private` (default: `private`) |
| supportedTaskTypes | string/array | ❌ | Supported task types |

### Response `200 OK`
```json
{
  "success": true,
  "campaign": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "campaignName": "Summer Sale 2025",
    "brandName": "Nike",
    "goal": "Increase brand awareness",
    "clientId": "64f1a2b3c4d5e6f7a8b9c0d0",
    "description": "Create reels showcasing our summer collection",
    "startDate": "2025-06-01T00:00:00.000Z",
    "endDate": "2025-06-30T00:00:00.000Z",
    "location": "Delhi",
    "credits": 100,
    "cutoff": 500,
    "limit": 50,
    "views": 10000,
    "status": "Active",
    "isActive": true,
    "campaignType": "public",
    "image": {
      "key": "clientId/campaignId/image.png",
      "url": "https://signed-url..."
    },
    "categoryImage": { "key": "", "url": "" },
    "brandImage": { "key": "", "url": "" },
    "tags": ["summer", "fashion"],
    "userIds": [],
    "createdAt": "2025-06-01T10:00:00.000Z"
  }
}
```

### Error Responses
```json
{ "success": false, "message": "Missing required fields" }
{ "success": false, "message": "End date must be after start date" }
{ "success": false, "message": "Server error", "error": "..." }
```

---

## 2. Upload Campaign Image

**POST** `/api/campaign/upload`

**Auth:** Required — `client`, `admin`, `super_admin`

**Content-Type:** `multipart/form-data`

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| image | file | ✅ | Image file (max 5MB, images only) |
| clientId | string | ✅ | Client ID |
| campaignName | string | ✅ | Campaign name (used to generate R2 key) |

### Response `200 OK`
```json
{
  "success": true,
  "key": "clientId/campaign-name-abc123/image.png"
}
```

---

## 3. Get All Active Campaigns

**GET** `/api/campaign/active`

**Auth:** Not required (public)

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| clientId | string | ❌ | Filter by client ID |

### Response `200 OK`
```json
{
  "success": true,
  "campaigns": [
    {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "campaignName": "Summer Sale 2025",
      "brandName": "Nike",
      "isActive": true,
      "status": "Active",
      "campaignType": "public",
      "startDate": "2025-06-01T00:00:00.000Z",
      "endDate": "2025-06-30T00:00:00.000Z",
      "image": { "key": "...", "url": "https://signed-url..." },
      "credits": 100
    }
  ]
}
```

> **Note:** This auto-activates campaigns whose startDate has arrived and deactivates expired ones.

---

## 4. Get Public Active Campaigns

**GET** `/api/campaign/active/public`

**Auth:** Not required

Returns only `campaignType: "public"` campaigns (no join required — direct task access).

### Response `200 OK`
```json
{
  "success": true,
  "campaigns": [ { "campaignType": "public", "..." : "..." } ]
}
```

---

## 5. Get Private Active Campaigns

**GET** `/api/campaign/active/private`

**Auth:** Not required

Returns only `campaignType: "private"` campaigns (join required). Also includes legacy campaigns with no campaignType set.

### Response `200 OK`
```json
{
  "success": true,
  "campaigns": [ { "campaignType": "private", "...": "..." } ]
}
```

---

## 6. Register User for Campaign

**POST** `/api/campaign/register/:campaignId`

**Auth:** Not required (userId passed in body)

### URL Params

| Param | Description |
|-------|-------------|
| campaignId | MongoDB `_id` of the campaign |

### Request Body
```json
{
  "userId": "google-oauth-id-or-mongoId"
}
```

### Response `200 OK`
```json
{
  "success": true,
  "registeredCampaign": {
    "userId": "google-oauth-id",
    "registeredCampaigns": [
      {
        "campaign": { "_id": "...", "campaignName": "Summer Sale 2025" },
        "registeredAt": "2025-06-01T10:00:00.000Z"
      }
    ]
  }
}
```

### Error Responses
```json
{ "success": false, "message": "Missing userId" }
{ "success": false, "message": "Campaign not found" }
```

> **Note:** Sends a Telegram alert when a user joins a campaign.

---

## 7. Get User Registered Campaigns

**GET** `/api/campaign/registered`

**Auth:** Not required

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| userId | string | ✅ (or googleId) | User's Google ID or MongoDB ID |
| googleId | string | ✅ (or userId) | User's Google ID |

### Response `200 OK`
```json
{
  "success": true,
  "active": [
    {
      "campaign": {
        "_id": "...",
        "campaignName": "Summer Sale 2025",
        "isActive": true,
        "image": { "key": "...", "url": "https://signed-url..." }
      },
      "registeredAt": "2025-06-01T10:00:00.000Z"
    }
  ],
  "expired": [
    {
      "campaign": { "_id": "...", "campaignName": "Old Campaign" },
      "registeredAt": "2025-01-01T10:00:00.000Z"
    }
  ]
}
```

---

## 8. Get Active Participants

**GET** `/api/campaign/activeparticipants/:campaignId`

**Auth:** Not required

### Response `200 OK`
```json
{
  "success": true,
  "activeParticipants": 25,
  "userIds": ["userId1", "userId2", "..."]
}
```

---

## 9. Set Active Participant

**POST** `/api/campaign/activeparticipants/:campaignId`

**Auth:** Not required

Adds a user to the campaign's active participants list (no duplicates).

### Request Body
```json
{
  "userId": "google-oauth-id-or-mongoId"
}
```

### Response `200 OK`
```json
{
  "success": true,
  "activeParticipants": 26,
  "userIds": ["userId1", "userId2", "newUserId"]
}
```

### Error Responses
```json
{ "success": false, "message": "userId must be provided as a string" }
{ "success": false, "message": "Campaign not found" }
```

---

## 10. Get All Client Campaign Stats

**GET** `/api/campaign/client/data/:clientId`

**Auth:** Not required

Returns aggregated stats across all campaigns for a client.

### Response `200 OK`
```json
{
  "success": true,
  "clientId": "64f1a2b3c4d5e6f7a8b9c0d0",
  "stats": {
    "totalVideos": 150,
    "totalViews": 500000,
    "totalLikes": 25000,
    "totalComments": 3000
  }
}
```

---

## 11. Get Campaigns by Client ID

**GET** `/api/campaign/client/:clientId`

**Auth:** Not required

### URL Params

| Param | Description |
|-------|-------------|
| clientId | MongoDB `_id` or `CLI-XXXXX` format |

### Response `200 OK`
```json
{
  "success": true,
  "campaigns": [
    {
      "_id": "...",
      "campaignName": "Summer Sale 2025",
      "brandName": "Nike",
      "image": { "key": "...", "url": "https://signed-url..." },
      "status": "Active",
      "isActive": true
    }
  ]
}
```

---

## 12. Get Campaign Analytics Data

**GET** `/api/campaign/data/:campaignId`

**Auth:** Not required

Returns total responses, views, likes, and comments for a campaign.

### Response `200 OK`
```json
{
  "success": true,
  "campaignId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "data": {
    "totalResponses": 45,
    "totalViews": 120000,
    "totalLikes": 8500,
    "totalComments": 950
  }
}
```

---

## 13. Get Campaign Response Videos

**GET** `/api/campaign/videos/:campaignId`

**Auth:** Not required

Returns all submitted video URLs for a campaign.

### Response `200 OK`
```json
{
  "success": true,
  "campaignId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "urls": [
    {
      "url": "https://instagram.com/reel/abc123",
      "Time": "2025-06-05T14:30:00.000Z"
    },
    {
      "url": "https://youtube.com/shorts/xyz789",
      "Time": "2025-06-06T09:15:00.000Z"
    }
  ]
}
```

---

## 14. Get User Dashboard Stats

**GET** `/api/campaign/response/data/:userId`

**Auth:** Not required

Returns overall stats for a user across all campaigns.

### URL Params

| Param | Description |
|-------|-------------|
| userId | User's Google ID |

### Response `200 OK`
```json
{
  "success": true,
  "totalCampaigns": 5,
  "acceptedTask": 3,
  "pendingTask": 1,
  "completedTask": 4,
  "totalCredits": 450,
  "totalViews": 25000,
  "totalLikes": 1200,
  "totalComments": 180
}
```

---

## 15. Get User Campaign Data

**GET** `/api/campaign/response/campaign/data/:userId`

**Auth:** Not required

Returns per-campaign stats for a user with campaign images.

### Response `200 OK`
```json
{
  "success": true,
  "campaigns": [
    {
      "campaignId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "campaignName": "Summer Sale 2025",
      "key": "clientId/campaignId/image.png",
      "url": "https://signed-url...",
      "isActive": true,
      "registeredAt": "2025-06-01T10:00:00.000Z",
      "views": 5000,
      "likes": 300,
      "comments": 45
    }
  ]
}
```

---

## 16. Get Participant City Map

**GET** `/api/campaign/:campaignId/citymap`

**Auth:** Not required

Returns top 10 cities with participant counts and coordinates for map visualization.

### Response `200 OK`
```json
{
  "success": true,
  "cities": [
    { "city": "Delhi", "count": 45, "lat": 28.6139, "lng": 77.2090 },
    { "city": "Mumbai", "count": 32, "lat": 19.0760, "lng": 72.8777 },
    { "city": "Bangalore", "count": 28, "lat": 12.9716, "lng": 77.5946 }
  ],
  "participantCount": 150,
  "totalCities": 12
}
```

---

## 17. Get Participant GeoJSON

**GET** `/api/campaign/:campaignId/geojson`

**Auth:** Not required

Returns GeoJSON boundary data and participant pin locations for map rendering.

### Response `200 OK`
```json
{
  "success": true,
  "geojson": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": { "type": "Polygon", "coordinates": [[...]] },
        "properties": { "pincode": "110001", "city": "Delhi", "state": "Delhi" }
      }
    ]
  },
  "bounds": [[28.4, 76.8], [28.9, 77.4]],
  "center": [28.65, 77.1],
  "participants": [
    {
      "id": "64f1a2b3...",
      "name": "John Doe",
      "city": "Delhi",
      "pincode": "110001",
      "lat": 28.6139,
      "lng": 77.2090,
      "address": "Connaught Place, New Delhi"
    }
  ],
  "pincodeCount": 8
}
```

---

## 18. Get Participant Location Stats

**GET** `/api/campaign/:campaignId/location/stats`

**Auth:** Not required

Returns location-based statistics for campaign participants.

### Response `200 OK`
```json
{
  "success": true,
  "campaignId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "stats": {
    "total": 150,
    "withLocation": 120,
    "withoutLocation": 30,
    "byCity": { "Delhi": 45, "Mumbai": 32 },
    "byState": { "Delhi": 50, "Maharashtra": 35 },
    "byPincode": { "110001": 12, "400001": 8 }
  }
}
```

---

## 19. Get Participants with Location Filters

**GET** `/api/campaign/:campaignId/location/filter`

**Auth:** Not required

Filter participants by location criteria.

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| pincode | string | ❌ | Filter by pincode |
| city | string | ❌ | Filter by city name |
| state | string | ❌ | Filter by state name |
| latitude | number | ❌ | Center latitude for radius filter |
| longitude | number | ❌ | Center longitude for radius filter |
| radiusKm | number | ❌ | Radius in kilometers |
| groupBy | string | ❌ | Group results by `city`, `state`, or `pincode` |

### Response `200 OK`
```json
{
  "success": true,
  "participants": [
    {
      "name": "John Doe",
      "city": "Delhi",
      "pincode": "110001",
      "lat": 28.6139,
      "lng": 77.2090
    }
  ],
  "stats": {
    "total": 150,
    "withLocation": 120,
    "byCity": { "Delhi": 45 }
  },
  "filterApplied": true,
  "totalFiltered": 45
}
```

---

## 20. Update Campaign

**PUT** `/api/campaign/:campaignId`

**Auth:** Required — `client`, `admin`, `super_admin`

**Content-Type:** `multipart/form-data`

### URL Params

| Param | Description |
|-------|-------------|
| campaignId | MongoDB `_id` of the campaign |

### Request Body

Same fields as Create Campaign — only send fields you want to update. Images are optional.

### Response `200 OK`
```json
{
  "success": true,
  "campaign": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "campaignName": "Updated Campaign Name",
    "status": "Active",
    "isActive": true,
    "updatedAt": "2025-06-10T12:00:00.000Z"
  }
}
```

### Error Responses
```json
{ "success": false, "message": "Campaign not found" }
{ "success": false, "message": "End date must be after start date" }
```

> **Note:** If campaign becomes active after update, a Telegram alert is sent automatically.

---

## 21. Delete Campaign

**DELETE** `/api/campaign/:campaignId`

**Auth:** Required — `client`, `admin`, `super_admin`

### Response `200 OK`
```json
{
  "success": true,
  "message": "Campaign deleted",
  "campaign": { "_id": "...", "campaignName": "Summer Sale 2025" }
}
```

### Error Responses
```json
{ "success": false, "message": "Campaign not found" }
```

---

## 22. Get Campaign by ID

**GET** `/api/campaign/:campaignId`

**Auth:** Not required

### Response `200 OK`
```json
{
  "success": true,
  "campaign": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "campaignName": "Summer Sale 2025",
    "brandName": "Nike",
    "goal": "Increase brand awareness",
    "description": "Create reels showcasing our summer collection",
    "startDate": "2025-06-01T00:00:00.000Z",
    "endDate": "2025-06-30T00:00:00.000Z",
    "location": "Delhi",
    "credits": 100,
    "cutoff": 500,
    "limit": 50,
    "status": "Active",
    "isActive": true,
    "campaignType": "public",
    "image": { "key": "...", "url": "https://signed-url..." },
    "tags": ["summer", "fashion"],
    "userIds": ["userId1", "userId2"]
  }
}
```

### Error Responses
```json
{ "success": false, "message": "Campaign not found" }
```

---

## Campaign Object Schema

| Field | Type | Description |
|-------|------|-------------|
| _id | ObjectId | MongoDB auto-generated ID |
| campaignName | string | Name of the campaign |
| brandName | string | Brand name |
| goal | string | Campaign objective |
| clientId | string | Client's MongoDB `_id` |
| description | string | Full campaign description |
| startDate | Date | Campaign start date |
| endDate | Date | Campaign end date |
| location | string | Target location |
| credits | number | Credits awarded per task |
| cutoff | number | Minimum views required |
| limit | number | Max participants allowed |
| views | number | Target views |
| status | string | `Active` or `Inactive` |
| isActive | boolean | Auto-computed from dates and status |
| campaignType | string | `public` or `private` |
| image | object | `{ key, url }` — main campaign image |
| categoryImage | object | `{ key, url }` — category image |
| brandImage | object | `{ key, url }` — brand logo |
| tags | string[] | Campaign tags |
| groupIds | string[] | Associated group IDs |
| userIds | string[] | Active participant user IDs |
| tNc | string | Terms and conditions |
| category | string | Campaign category |
| supportedTaskTypes | array | Allowed task types |
| createdAt | Date | Auto timestamp |
| updatedAt | Date | Auto timestamp |

---

## Campaign Type Explanation

| Type | Description |
|------|-------------|
| `public` | No join required. Users can directly access tasks. Shown in Task tab. |
| `private` | Join required. Client assigns tasks to specific users. Shown in Campaign tab. |

---

## Auto Activation Logic

- Campaign becomes `isActive: true` when `startDate <= now <= endDate` AND `status !== 'Inactive'`
- Campaign becomes `isActive: false` automatically when `endDate < now`
- This check runs on every call to `/active`, `/active/public`, `/active/private`

---

## Telegram Alerts

The following events trigger automatic Telegram notifications:

| Event | Trigger |
|-------|---------|
| Campaign Created | `POST /api/campaign/` |
| Campaign Activated | `PUT /api/campaign/:id` (when isActive changes to true) |
| User Joined Campaign | `POST /api/campaign/register/:campaignId` |
