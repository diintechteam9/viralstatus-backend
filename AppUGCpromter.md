# UGC Prompter — Android App API Documentation

**Base URL:** `https://viralstatus-backend-production.up.railway.app`

**Authentication:** Har request mein `Authorization: Bearer <token>` header bhejo.

**Mobile User Token** tab milta hai jab user login karta hai `/api/mobile/user/login` se.

---

## Status Flow (Video Life Cycle)

```
submitted → editing_requested → editing → edited → approved
                                                  ↘ rejected → (re-edit cycle)
```

---

## API 1 — Get Active Script (Prompt)

**Endpoint:** `GET /api/ugc-prompter/public/:promptId`

**Who calls it:** MobileUser — script/instructions dekhne ke liye

**Headers:**
```
Authorization: Bearer <mobileuser_token>
```

**Success Response `200`:**
```json
{
  "success": true,
  "prompt": {
    "_id": "664abc123...",
    "title": "Review our new product",
    "category": "testimonial",
    "tone": "casual",
    "duration": 30,
    "script": "[HOOK]\nHey everyone...\n\n[MAIN CONTENT]\n...\n\n[CTA]\nCheck link in bio!",
    "status": "active",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `404` — Prompt not found
- `403` — Prompt is not active

---

## API 2 — Get Upload URL (Presigned)

**Endpoint:** `POST /api/ugc-video/upload-url`

**Who calls it:** MobileUser — video upload karne se pehle presigned URL lene ke liye

**Headers:**
```
Authorization: Bearer <mobileuser_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "promptId": "664abc123...",
  "fileName": "my_video.mp4",
  "contentType": "video/mp4"
}
```

**Success Response `200`:**
```json
{
  "success": true,
  "uploadUrl": "https://r2.cloudflarestorage.com/bucket/ugc-videos/...?X-Amz-Signature=...",
  "key": "ugc-videos/664abc123.../userId_1234567890.mp4"
}
```

**How to use `uploadUrl`:**
```
PUT <uploadUrl>
Content-Type: video/mp4
Body: <raw video binary>
```

Save the `key` — aapko next step mein chahiye hoga.

---

## API 3 — Submit Video (After Upload)

**Endpoint:** `POST /api/ugc-video`

**Who calls it:** MobileUser — R2 upload complete hone ke baad

**Headers:**
```
Authorization: Bearer <mobileuser_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "promptId": "664abc123...",
  "videoKey": "ugc-videos/664abc123.../userId_1234567890.mp4",
  "note": "Recorded in natural light"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| promptId | string | ✅ | Prompt ka ID |
| videoKey | string | ✅ | R2 key from API 2 |
| note | string | ❌ | Optional note from user |

**Success Response `201`:**
```json
{
  "success": true,
  "video": {
    "_id": "665xyz789...",
    "promptId": "664abc123...",
    "videoKey": "ugc-videos/...",
    "status": "submitted",
    "processingStatus": "none",
    "note": "Recorded in natural light",
    "createdAt": "2025-01-01T00:00:00.000Z"
  },
  "message": "Video submitted. AI processing started."
}
```

> **Note:** Backend automatically AI processing pipeline start kar deta hai background mein.

---

## API 4 — Get All My Videos

**Endpoint:** `GET /api/ugc-video`

**Who calls it:** MobileUser — "My Recordings" screen populate karne ke liye

**Headers:**
```
Authorization: Bearer <mobileuser_token>
```

**Query Params (optional):**
```
?promptId=664abc123...    // filter by specific prompt
```

**Success Response `200`:**
```json
{
  "success": true,
  "videos": [
    {
      "_id": "665xyz789...",
      "promptId": {
        "_id": "664abc123...",
        "title": "Review our new product",
        "category": "testimonial",
        "script": "...",
        "platform": "instagram",
        "tone": "casual",
        "duration": 30,
        "brandName": "YovoAI"
      },
      "videoKey": "ugc-videos/...",
      "videoUrl": "https://signed-url-to-raw-video...",
      "status": "submitted",
      "processingStatus": "processing",
      "processingProgress": 45,
      "note": "Recorded in natural light",
      "editedVideoKey": "",
      "editedVideoUrl": "",
      "processedVideoUrl": "",
      "viralVideoUrl": "",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:05:00.000Z"
    }
  ]
}
```

**Video Status Values:**

| Status | Meaning |
|--------|---------|
| `submitted` | Video uploaded, awaiting review |
| `editing_requested` | User ne edit request ki, backend processing pending |
| `editing` | Backend editing in progress |
| `edited` | Editing complete, editedVideoUrl available |
| `approved` | User ne accept kiya |
| `rejected` | User ne reject kiya |
| `objection` | Client ne objection raise ki |

**processingStatus Values (AI Pipeline):**

| processingStatus | Meaning |
|-----------------|---------|
| `none` | AI processing shuru nahi hua |
| `uploading` | Video AI server pe upload ho raha hai |
| `processing` | AI editing chal rahi hai |
| `completed` | AI processing done, processedVideoUrl available |
| `failed` | AI processing fail hua |

---

## API 5 — Check AI Processing Status (Polling)

**Endpoint:** `GET /api/ugc-video/:id/status`

**Who calls it:** MobileUser — AI processing progress check karne ke liye (poll every 10-15 seconds)

**Headers:**
```
Authorization: Bearer <mobileuser_token>
```

**Success Response `200`:**
```json
{
  "success": true,
  "_id": "665xyz789...",
  "status": "submitted",
  "processingStatus": "processing",
  "processingProgress": 65,
  "aiJobId": "job_abc123",
  "processedVideoUrl": "",
  "viralVideoUrl": ""
}
```

> **Polling Logic:** Jab `processingStatus === "completed"` ho tab polling band karo aur `processedVideoUrl` show karo.

---

## API 6 — Request Video Editing ⭐ NEW

**Endpoint:** `POST /api/ugc-video/:id/request-edit`

**Who calls it:** MobileUser — "Edit Video" button click karne par

**Headers:**
```
Authorization: Bearer <mobileuser_token>
Content-Type: application/json
```

**URL Param:** `:id` = video ka `_id`

**Request Body:** (empty body bhi chalega)
```json
{}
```

**Success Response `200`:**
```json
{
  "success": true,
  "status": "editing_requested",
  "message": "Edit request submitted successfully"
}
```

**Allowed current statuses to call this API:**
- `submitted`
- `approved`
- `rejected`

**Error Responses:**
- `400` — Cannot request edit for video with status: edited (already being edited)
- `403` — Unauthorized (not your video)
- `404` — Video not found

> **Backend Flow:** Status `editing_requested` → Backend/Admin manually sets to `editing` → editing complete hone par `edited` ho jata hai aur `editedVideoUrl` available hoti hai.

---

## API 7 — Accept Edited Video ⭐ NEW

**Endpoint:** `POST /api/ugc-video/:id/accept`

**Who calls it:** MobileUser — edited video preview karke "Accept" button click karne par

**Headers:**
```
Authorization: Bearer <mobileuser_token>
Content-Type: application/json
```

**URL Param:** `:id` = video ka `_id`

**Request Body:** (empty)
```json
{}
```

**Success Response `200`:**
```json
{
  "success": true,
  "status": "approved",
  "editedVideoUrl": "https://signed-url-to-edited-video...",
  "message": "Video accepted successfully"
}
```

**Condition:** Video ka status `edited` hona chahiye, tabhi accept kar sakte ho.

**Error Responses:**
- `400` — Cannot accept video with status: submitted (must be 'edited')
- `403` — Unauthorized
- `404` — Video not found

---

## API 8 — Reject Edited Video ⭐ NEW

**Endpoint:** `POST /api/ugc-video/:id/reject`

**Who calls it:** MobileUser — edited video preview karke "Reject" button click karne par

**Headers:**
```
Authorization: Bearer <mobileuser_token>
Content-Type: application/json
```

**URL Param:** `:id` = video ka `_id`

**Request Body:**
```json
{
  "reason": "Color grading is off, please fix it"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| reason | string | ❌ | Rejection reason / feedback |

**Success Response `200`:**
```json
{
  "success": true,
  "status": "rejected",
  "message": "Video rejected. Backend will re-process."
}
```

**Condition:** Video ka status `edited` hona chahiye.

**Error Responses:**
- `400` — Cannot reject video with status: submitted (must be 'edited')
- `403` — Unauthorized
- `404` — Video not found

---

## API 9 — Delete Video

**Endpoint:** `DELETE /api/ugc-video/:id`

**Who calls it:** MobileUser — apna video delete karne ke liye

**Headers:**
```
Authorization: Bearer <mobileuser_token>
```

**Success Response `200`:**
```json
{
  "success": true,
  "message": "Video deleted"
}
```

---

## Complete Flow — Step by Step

```
1. GET  /api/ugc-prompter/public/:promptId   → Script/instructions fetch karo
        ↓
2. POST /api/ugc-video/upload-url            → Presigned URL lo
        ↓
3. PUT  <uploadUrl>                          → Direct R2 pe video upload karo (no backend)
        ↓
4. POST /api/ugc-video                       → Backend ko notify karo (video submit)
        ↓
5. GET  /api/ugc-video                       → "My Recordings" screen — videos list
        ↓
6. GET  /api/ugc-video/:id/status            → AI processing poll karo (every 15s)
        ↓
7. POST /api/ugc-video/:id/request-edit      → User "Edit Video" click kare
        ↓
        [Backend editing in progress — status: editing]
        ↓
8. GET  /api/ugc-video                       → Poll karo, jab status = "edited" ho
        ↓
9a. POST /api/ugc-video/:id/accept           → User edited video accept kare → status: approved
9b. POST /api/ugc-video/:id/reject           → User reject kare → status: rejected (re-edit cycle)
```

---

## Error Response Format (All APIs)

```json
{
  "success": false,
  "message": "Error description here"
}
```

**Common HTTP Status Codes:**

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request (missing/invalid fields) |
| `401` | Unauthorized (no/invalid token) |
| `403` | Forbidden (not your resource) |
| `404` | Not Found |
| `500` | Server Error |

---

## Authentication — How to Get Token

**Login Endpoint:** `POST /api/mobile/user/login`

```json
{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "...",
    "name": "User Name",
    "email": "user@example.com",
    "role": "mobileuser"
  }
}
```

Token ko `Authorization: Bearer <token>` header mein bhejo har request ke saath.

---

## Notes for Android Developer

1. **Video Upload Flow:** Direct R2 pe upload hota hai (presigned URL se) — backend pe video binary mat bhejo, bahut slow hoga.

2. **Polling:** `processingStatus` ke liye 15 second interval pe poll karo. Jab `completed` ya `failed` aaye tab band karo.

3. **editedVideoUrl:** Ye signed URL hai, 1 hour mein expire hoti hai. Har baar `GET /api/ugc-video` call karo fresh URL ke liye.

4. **Status Check for UI:**
   - `submitted` → Show "Pending Review" badge
   - `editing_requested` → Show "Edit Requested" badge
   - `editing` → Show "Editing in Progress" loader
   - `edited` → Show edited video preview + Accept/Reject buttons
   - `approved` → Show "Approved ✅" badge
   - `rejected` → Show "Rejected ❌" + option to re-request edit

5. **Token Expiry:** Agar `401 Token expired` aaye to user ko logout karke login screen pe bhejo.
