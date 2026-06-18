# News & Blog — Complete Documentation

## Overview

YovoAI platform ka News & Blog system teen alag features ka combination hai:

| Feature | Kya karta hai | Kaun use karta hai |
|---|---|---|
| **News & Blog Manager** | Posts create/edit/delete/publish karo | Admin Dashboard |
| **News Reel Generator** | Topic → Article → Audio → Images → MP4 Reel | Client Dashboard |
| **Blog Generator** | Heading → Full HTML Blog (AI + Images) | Client Dashboard |

---

## 1. News & Blog Manager (Admin Dashboard)

### Location
- Frontend: `viralstatus-frontend/src/component/dashboards/AdminNewsBlog.jsx`
- Backend Controller: `viralstatus-backend/controllers/newsBlogController.js`
- Routes: `viralstatus-backend/routes/newsBlogRoutes.js`
- Database Model: `viralstatus-backend/models/NewsBlog.js`

### Database Schema — `NewsBlog` Model

```js
// models/NewsBlog.js
{
  title:      String,   // required
  category:   String,   // enum: News | Blog | Announcement | Update | Tips
  summary:    String,
  content:    String,   // required (full post body)
  author:     String,
  tags:       [String],
  imageUrl:   String,   // lead/cover image
  media:      [{ type: image|video, url, caption }],  // gallery
  published:  Boolean,  // true = live, false = draft
  likesCount: Number,
  shareCount: Number,
  likedBy:    [String]  // visitor IDs who liked
}
// + timestamps: createdAt, updatedAt
```

Comment Model — `NewsBlogComment`
```js
// models/NewsBlogComment.js
{
  postId:     ObjectId → NewsBlog,
  authorName: String,
  text:       String,
  visitorId:  String
}
```

---

## 2. API Routes — `/api/news-blog`

### Public Routes (no auth needed)

| Method | Endpoint | Kya karta hai |
|---|---|---|
| GET | `/api/news-blog` | Saare posts fetch karo (`?published=true` filter) |
| GET | `/api/news-blog/:id` | Ek post detail |
| GET | `/api/news-blog/external` | NewsAPI se live news articles (influencer marketing) |
| GET | `/api/news-blog/:id/comments` | Post ke comments |
| POST | `/api/news-blog/:id/comment` | Comment add karo |
| POST | `/api/news-blog/:id/like` | Like/unlike toggle |
| POST | `/api/news-blog/:id/share` | Share count badhao |

### Admin Routes (JWT token required — `admintoken`)

| Method | Endpoint | Kya karta hai |
|---|---|---|
| POST | `/api/news-blog` | Naya post create |
| PUT | `/api/news-blog/:id` | Post update |
| DELETE | `/api/news-blog/:id` | Post delete |
| PATCH | `/api/news-blog/:id/publish` | Publish/Unpublish toggle |
| POST | `/api/news-blog/upload-cover` | Cover image upload (multipart) |
| POST | `/api/news-blog/upload-cover-base64` | Cover image upload (base64 JSON) |
| POST | `/api/news-blog/upload-media` | Multiple images+videos upload |
| POST | `/api/news-blog/auto-generate` | Manual auto-generate trigger |

---

## 3. Admin Dashboard — Features

### 3.1 Post Create/Edit
Admin manually post bana sakta hai:
- Title, Category, Summary, Content, Author, Tags
- Cover Image: file upload ya URL paste ya AI generate
- Media Gallery: multiple images+videos upload
- Published toggle (immediate ya draft)

### 3.2 AI Fill Feature
```
Topic likho → AI (Groq LLaMA) → Title + Summary + Content + Tags auto fill
API: POST /api/ai/news-blog-fill  { topic, category }
```

### 3.3 AI Image Generator (Pollinations)
```
Prompt likho → 6 AI images generate → click to select as cover
API: POST /api/image-proxy/generate-one  { prompt, index }
```

### 3.4 Analytics Dashboard
- Total posts, Published, Drafts count
- Likes / Comments / Shares total
- Category distribution bar chart
- Top 5 performing posts (engagement score)

### 3.5 Post Actions (3-dot menu)
- View preview
- Edit
- Enable / Disable (publish toggle)
- Delete

---

## 4. Auto Generate — Automatic News & Blog Posts

### File: `viralstatus-backend/services/autoPostService.js`

### Kaise Kaam Karta Hai

```
Cron Job (5x daily) → runAutoPostJob()
  → pickUnusedTopic(NEWS_TOPICS)   → generatePostContent() via Groq
  → pickUnusedTopic(BLOG_TOPICS)   → generatePostContent() via Groq
  → fetchImage() via Unsplash (fallback: Pollinations)
  → NewsBlog.create() → MongoDB save
  → Published: true (live immediately)
```

### Schedule (IST Timezone)

| Time | Posts Generated |
|---|---|
| 8:00 AM | 1 News + 1 Blog |
| 11:00 AM | 1 News + 1 Blog |
| 2:00 PM | 1 News + 1 Blog |
| 5:00 PM | 1 News + 1 Blog |
| 8:00 PM | 1 News + 1 Blog |
| **Total/day** | **10 posts** |

### index.js me cron setup:
```js
// viralstatus-backend/index.js
const cron = require('node-cron');
const { runAutoPostJob } = require('./services/autoPostService');

const autoPostTimes = [
  '0 8 * * *',   // 8:00 AM IST
  '0 11 * * *',  // 11:00 AM IST
  '0 14 * * *',  // 2:00 PM IST
  '0 17 * * *',  // 5:00 PM IST
  '0 20 * * *',  // 8:00 PM IST
];

autoPostTimes.forEach(time => {
  cron.schedule(time, () => runAutoPostJob(), { timezone: 'Asia/Kolkata' });
});
```

### Topic Pools (20 topics each)
- `NEWS_TOPICS[]` — YovoAI brand news topics (20)
- `BLOG_TOPICS[]` — YovoAI how-to blog topics (20)
- Same-day me same topic repeat nahi hota (`usedTopicsToday` Set track karta hai)

### AI Used: Groq LLaMA-3.3-70B
```
Model: llama-3.3-70b-versatile
Prompt: topic diya → returns JSON { title, summary, content, tags, imageQuery }
Retry: 3 attempts with 4s delay on failure
```

### Image Fetch Flow
```
1st choice: Unsplash API (UNSPLASH_ACCESS_KEY se)
Fallback:   Pollinations.ai (free, no key needed)
URL: https://image.pollinations.ai/prompt/{encoded}?width=800&height=450
```

### Manual Trigger (Admin Dashboard)
Admin "⚡ Auto Generate" button dabaye → API call:
```
POST /api/news-blog/auto-generate
→ Response immediately (background me run)
→ 30-60 seconds baad posts appear
```

---

## 5. News Reel Generator (Client Dashboard)

### Location
- Frontend: `viralstatus-frontend/src/component/dashboards/NewsGenerator.jsx`
- Route: `viralstatus-backend/routes/newsGeneratorRoute.js` → `/api/news/generate-news`

### 4-Step Pipeline

```
Topic (user input)
  ↓
Step 1: Article Generate (Groq)
  → POST /api/news/generate-news
  → Returns: { headline, subheadline, body, fullArticle }
  ↓
Step 2: Voice Convert (Azure TTS)
  → POST /api/videocard/azure-tts
  → Returns: audio (base64 MP3)
  ↓
Step 3: Image Generate (Puter.js → DALL-E)
  → 5 prompts generate → 5 scene images (base64)
  → Puter SDK (free DALL-E via puter.com)
  ↓
Step 4: Final Video (FFmpeg async job)
  → SRT generate: POST /api/vtr/generate-srt (Deepgram)
  → Video create: POST /api/videocard/generate-finalvideo-async
  → Poll job: GET /api/videocard/job-status/:jobId
  → Output: MP4 reel with subtitles
```

### User Input Options
- Topic (text)
- Category: Business / Technology / Sports / Entertainment / Health / Politics / Science
- Tone: Formal / Casual / Breaking News / Analytical
- Language: English / Hindi / Marathi / Gujarati / Tamil / Telugu
- Voice: Azure Neural voices (14 options — gender + language)

### APIs Used
| Step | Service | API Key Env Var |
|---|---|---|
| Article | Groq LLaMA-3.3-70B | `GROQ_API_KEY` |
| Voice | Azure TTS (Neural) | `AZURE_Voice_API_KEY` |
| Images | Puter.js / DALL-E | (Puter account, free) |
| Subtitles | Deepgram | `DEEPGRAM_API_KEY` |
| Video | FFmpeg (local) | — |

---

## 6. Blog Generator (Client Dashboard)

### Location
- Frontend: `viralstatus-frontend/src/component/dashboards/BlogGenerator.jsx`
- Route: `viralstatus-backend/routes/blogGeneratorRoute.js` → `/api/blog`

### Kaise Kaam Karta Hai

```
User Input: Heading + Description + Category + Tone + Language + Color Theme
  ↓
Image Search Term → POST /api/blog/image-search-term (Gemini)
  ↓
Unsplash Images → GET /api/blog/unsplash-images?query=...
  ↓
Blog HTML Generate → POST /api/blog/generate (Gemini 2.5 Flash Lite)
  → Returns: Complete single-file HTML blog post
  ↓
Live Preview (iframe) + AI Chat Editor (modify karo)
  → POST /api/blog/modify  { currentHTML, userRequest }
  ↓
Download as .html file ya Copy HTML
```

### Input Options
- Category: Technology / Business / Health / Travel / Food / Finance / Education / Lifestyle / Sports / Entertainment
- Tone: Professional / Casual / Informative / Persuasive / Storytelling
- Language: English / Hindi / Marathi / Gujarati / Tamil / Telugu
- Color Themes: Ocean Blue / Sunset / Forest / Royal / Fire / Gold

### AI Suggestions
```
Heading likho → POST /api/blog/suggestions → 6 description ideas (Gemini)
```

### Generated Blog Features
AI-generated HTML blog includes:
- Dark theme (#0a0a0f background)
- Google Font: Inter
- Table of Contents (smooth scroll)
- Reading progress bar
- Like button with animation
- Comments section (localStorage)
- Social share footer
- Fully responsive (mobile)
- Back to Top button

### APIs Used
| Feature | Service | API Key |
|---|---|---|
| Blog generate | Gemini 2.5 Flash Lite | `GEMINI_API_KEY` |
| Suggestions | Gemini | `GEMINI_API_KEY_2` |
| Images | Unsplash | `UNSPLASH_ACCESS_KEY` |
| Image fallback | Picsum (free) | — |

---

## 7. Auto Post Flow — Complete Diagram

```
                    ┌─────────────────────────────────┐
                    │         node-cron (IST)          │
                    │  8AM, 11AM, 2PM, 5PM, 8PM        │
                    └──────────────┬──────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────┐
                    │        runAutoPostJob()          │
                    │  services/autoPostService.js     │
                    └──────────────┬──────────────────┘
                                   │
               ┌───────────────────┴─────────────────────┐
               │                                         │
               ▼                                         ▼
   pickUnusedTopic(NEWS_TOPICS)           pickUnusedTopic(BLOG_TOPICS)
               │                                         │
               ▼                                         ▼
   generatePostContent(topic, 'News')    generatePostContent(topic, 'Blog')
   → Groq LLaMA-3.3-70B                 → Groq LLaMA-3.3-70B
   → { title, summary, content,          (4s delay between calls)
       tags, imageQuery }
               │
               ▼
   fetchImage(imageQuery)
   → Unsplash API
   → Fallback: Pollinations.ai
               │
               ▼
   NewsBlog.create({ ...data, published: true })
   → MongoDB Atlas save
               │
               ▼
   ✅ Post live on /api/news-blog
```

---

## 8. Image Upload Flow

### Cover Image (3 ways)
```
1. File Upload → POST /api/news-blog/upload-cover (multipart)
   → Multer (memoryStorage, 8MB limit) → R2 bucket → presigned URL

2. Base64 Upload → POST /api/news-blog/upload-cover-base64 (JSON)
   → Buffer extract → R2 bucket → presigned URL
   (AI-generated images ke liye)

3. URL Paste → Directly imageUrl field me save
```

### Media Gallery Upload
```
POST /api/news-blog/upload-media (multipart, field: files[])
→ Images: 80MB limit, multiple files
→ Videos: MP4/WebM support
→ R2 bucket → presigned URLs
→ Returns: [{ type, url, caption }]
```

### R2 Storage Paths
```
Covers: news-blog/covers/{timestamp}-{random}-{filename}.{ext}
Images: news-blog/media/{timestamp}-{random}-{filename}.{ext}
Videos: news-blog/videos/{timestamp}-{random}-{filename}.{ext}
```

---

## 9. Environment Variables Required

```env
# Auto Post
GROQ_API_KEY=           # Groq LLaMA API (auto generate + news reel)
UNSPLASH_ACCESS_KEY=    # Unsplash images
UNSPLASH_SECRET_KEY=    # (backup)

# Blog Generator
GEMINI_API_KEY=         # Gemini 2.5 Flash Lite (blog generate)
GEMINI_API_KEY_2=       # Gemini (suggestions + image search term)

# News Reel
AZURE_Voice_API_KEY=    # Azure TTS
DEEPGRAM_API_KEY=       # Audio → SRT subtitles

# Storage
R2_BUCKET=              # Cloudflare R2 bucket name
R2_ACCOUNT_ID=
R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_ENDPOINT=

# External News
NEWS_API_KEY=           # NewsAPI.org (external articles)
```

---

## 10. Client Dashboard me News & Blog Sections

Client dashboard me ye sections available hain:

| Section | Component | Route/Feature |
|---|---|---|
| News Reel Generator | `NewsGenerator.jsx` | Topic → MP4 reel |
| Blog Generator | `BlogGenerator.jsx` | Heading → HTML blog |
| (View posts) | Public API | `/api/news-blog?published=true` |

Admin dashboard me:
| Section | Component |
|---|---|
| News & Blog Manager | `AdminNewsBlog.jsx` |

---

## 11. Key Code Files Summary

```
viralstatus-backend/
├── controllers/newsBlogController.js   # CRUD + upload handlers
├── models/NewsBlog.js                  # Post schema
├── models/NewsBlogComment.js           # Comment schema
├── routes/newsBlogRoutes.js            # All /api/news-blog routes
├── routes/newsGeneratorRoute.js        # /api/news/generate-news (Groq)
├── routes/blogGeneratorRoute.js        # /api/blog/* (Gemini)
├── services/autoPostService.js         # Cron auto-generate logic
└── index.js                            # Cron schedule setup (line ~120)

viralstatus-frontend/src/component/dashboards/
├── AdminNewsBlog.jsx                   # Admin post manager
├── NewsGenerator.jsx                   # Client news reel pipeline
├── BlogGenerator.jsx                   # Client blog HTML generator
└── blogutils/
    ├── gemini.js                       # Gemini API calls
    └── unsplash.js                     # Unsplash search
```

---

## 12. Concurrency & Error Handling

### Auto Post
- `isRunning` flag — overlapping runs prevent hoti hain
- Groq 3 retries with 4s delay
- Image fallback chain (Unsplash → Pollinations)

### News Reel Generator
- Groq: 3 attempt fallback strategy (strict JSON → non-strict → ultra-strict → template)
- Puter images: 3 retries with 4s/8s backoff per scene
- Video: async job polling (max 8 minutes)

### Blog Generator
- Auth middleware on all `/api/blog` routes
- SSRF guard on Unsplash query (alphanumeric only)
- Trusted image domain whitelist (unsplash.com, picsum.photos)
