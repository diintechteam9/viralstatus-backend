# Deploy backend on [Railway](https://railway.com/)

## 1. Repo setup

- **New Project** → **Deploy from GitHub** → repo select karo.
- Service **Settings → Root Directory** = `viralstatus-backend` (monorepo ho to zaroori).
- Ya sirf backend folder wala alag repo use karo — phir root default rahega.

`railway.json` isi folder me hai; Railway deploy par isko merge karta hai ([config-as-code](https://docs.railway.com/reference/config-as-code)).

## 2. Environment variables

Railway dashboard → service → **Variables**. Apni local `.env` se copy karo (secrets yahin paste karo, git me mat commit karo).

Kam se kam:

| Variable | Notes |
|----------|--------|
| `MONGO_URI` | MongoDB connection string (required) |
| `DEFAULT_MOBILE_CLIENT_ID` | `CLI-XXXXXX` for YOHO Flutter app registration (e.g. `CLI-UOVNVD`) |
| `JWT_SECRET` / session secrets | Production ke liye strong values |
| `NODE_ENV` | `production` |
| `FRONTEND_URL`, `BACKEND_URL` | Public frontend URL (CORS / redirects) |
| `PORT` | **Railway set karta hai** — manually zarurat nahi, `index.js` already `process.env.PORT` use karta hai |

Social Sensing / AI (agar use ho):

- `SERPAPI_KEY`, `NEWS_API_KEY`, `GROQ_API_KEY`, `TWITTER_BEARER_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `YOUTUBE_API_KEY`, Reddit keys, R2/S3, etc.

## 3. Public URL

- **Settings → Networking → Generate Domain** (HTTPS).
- Frontend env me **poora URL** lagao (protocol zaroori):

```env
VITE_BACKEND_URL=https://viralstatus-backend-production.up.railway.app
```

Galat (405 / login fail): `viralstatus-backend-production.up.railway.app` — bina `https://` ke browser request frontend par bhej deta hai.

## 4. Health check

`railway.json` me `healthcheckPath`: `/api/health` — aapke `index.js` ke route se match karta hai.

## 5. Build fail (Puppeteer / native modules)

Agar `npm ci` par `puppeteer` / `sharp` se error aaye:

- Railway service me **Dockerfile** use karo, ya
- Variables: `PUPPETEER_SKIP_DOWNLOAD=true` + system Chrome path (Railway docs dekho), ya
- Dockerfile me official Node image + required OS libs add karo.

Pehle default **Railpack** build try karo; zyada tar case me chal jata hai.

## 6. MongoDB on Railway

Optional: Railway par **MongoDB** plugin add karo → connection string variable me bind karo.
