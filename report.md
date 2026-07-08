# Backend API Changes Report
**Date:** 2026-07-08  
**Project:** YOHO AI / Yovo AI Backend  

---

## Summary

Public tasks aur private tasks ab **ek hi API** se milenge.  
Alag se `GET /api/campaign-tasks/public/all` call karne ki zaroorat **nahi** hai.

---

## Main Change — Single API for All Tasks

### API Endpoint
```
GET /api/pools/shared/:userId
```

### Pehle kya tha
- Private tasks → `GET /api/pools/shared/:userId`
- Public tasks → `GET /api/campaign-tasks/public/all?userId=<id>`
- Dono alag-alag call karne padte the

### Ab kya hai
- **Ek hi API** — `GET /api/pools/shared/:userId`
- Private + Public **dono** tasks ek saath return hote hain
- Koi extra call nahi

---

## Response Format

Response format **bilkul same** hai jaise pehle tha. Sirf 2 naye fields add hue hain:

| Field | Type | Description |
|-------|------|-------------|
| `isPublicTask` | `boolean` | `true` = public task, `false` = private task |
| `campaignType` | `string` | `"public"` ya `"private"` |

### Example Response
```json
{
  "success": true,
  "reels": [
    {
      "_id": "...",
      "title": "Private Task Example",
      "campaignType": "private",
      "isPublicTask": false,
      "TaskStatus": "accepted",
      "isTaskAccepted": true,
      ...
    },
    {
      "_id": "...",
      "title": "Public Task Example",
      "campaignType": "public",
      "isPublicTask": true,
      "TaskStatus": "assigned",
      "isTaskAccepted": false,
      ...
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

---

## Task Status Flow

### Public Task — Pehli Baar (User ne accept nahi kiya)
```
isPublicTask: true
campaignType: "public"
TaskStatus: "assigned"
isTaskAccepted: false
acceptedAt: null
remainingMs: 0
```

### Public Task — Accept karne ke baad
```
isPublicTask: true
campaignType: "public"
TaskStatus: "accepted"
isTaskAccepted: true
acceptedAt: "2026-07-08T06:25:26.955Z"
remainingMs: 599000   ← timer chal raha hai
```

---

## Accept Task API (Same as before — no change)

```
POST /api/pools/task/accept
Content-Type: application/json

Body:
{
  "userId": "<googleId>",
  "reelId": "<task _id>",
  "campaignId": "<campaignId>"
}
```

**Note:** Public task accept karne ke liye `reelId` mein task ka `_id` pass karo (jo `GET /api/pools/shared/:userId` response mein aata hai).

---

## Cancel Task API (Same as before — no change)

```
POST /api/pools/task/cancel
Content-Type: application/json

Body:
{
  "userId": "<googleId>",
  "reelId": "<task _id>",
  "campaignId": "<campaignId>",
  "reason": "user reason"
}
```

---

## Flutter App mein Kya Karna Hai

### 1. Public tasks ki alag API call hatao
```dart
// ❌ YEH HATAO — ab zaroorat nahi
GET /api/campaign-tasks/public/all?userId=...

// ✅ SIRF YEH USE KARO
GET /api/pools/shared/:userId
```

### 2. `isPublicTask` field se UI differentiate karo
```dart
if (task.isPublicTask == true) {
  // Public task UI show karo
  // Accept button dikhao agar isTaskAccepted == false
} else {
  // Private task UI show karo
}
```

### 3. Public task accept karna
```dart
// isTaskAccepted == false ho tab Accept button dikhao
// Accept press karne par:
POST /api/pools/task/accept
{
  "userId": currentUser.googleId,
  "reelId": task._id,        // task ka _id
  "campaignId": task.campaignId
}
```

### 4. Pagination same hai
```
GET /api/pools/shared/:userId?page=1&limit=20
```

---

## All Task Status Values

| TaskStatus | Matlab |
|------------|--------|
| `assigned` | Task available hai, user ne accept nahi kiya |
| `accepted` | User ne accept kar liya, kaam karna hai |
| `in_progress` | User ne proof submit kar diya, review pending |
| `completed` | Task complete aur approved |
| `rejected` | Task reject hua (response mein nahi aata) |

---

## Important Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Task subdocument ID (SharedReels entry) |
| `reelId` | string | Original reel/task ID |
| `campaignTaskId` | string | CampaignTask collection ka ID |
| `campaignId` | string | Campaign ID |
| `isPublicTask` | boolean | Public task hai ya nahi |
| `campaignType` | string | `"public"` / `"private"` |
| `TaskStatus` | string | Current task status |
| `isTaskAccepted` | boolean | Accept hua hai ya nahi |
| `isTaskComplete` | boolean | Complete hua hai ya nahi |
| `acceptedAt` | string/null | Accept time (ISO date) |
| `remainingMs` | number | Timer remaining milliseconds (0 = expired/not started) |
| `timerExpired` | boolean | Timer expire hua hai ya nahi |
| `penaltyZone` | boolean | Penalty zone mein hai ya nahi |
| `cancelCount` | number | Kitni baar cancel kiya |
| `credits` | number | Task ke credits |
| `campaign` | object | Campaign details (name, image, etc.) |
| `submission` | object/null | Submission details agar submit kiya ho |

---

## Deprecated API (Still works but not needed)

```
GET /api/campaign-tasks/public/all?userId=<googleId>
```
Yeh API abhi bhi kaam karti hai lekin **ab use mat karo**.  
Sab kuch `GET /api/pools/shared/:userId` se milega.

---

## Bug Fixes Done (For Reference)

1. **Public task accept ke baad status change nahi hota tha** — Fixed. Ab accept karte hi `TaskStatus: "accepted"` aata hai.
2. **Public task private API mein duplicate dikhta tha** — Fixed. Ab sirf ek jagah dikhega.
3. **Expired deadline wale tasks show hote the** — Fixed. Ab filter ho jaate hain.
4. **`userReelMap` lookup fail hota tha** — Fixed. `campaignTaskId` + `reelId` dono se lookup hota hai.
