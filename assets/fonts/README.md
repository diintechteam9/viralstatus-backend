Bundled font for ffmpeg drawtext (no system font dependency)

Place `NotoSans-Regular.ttf` in this directory so the backend can use it via `fontfile`.

Recommended font (Google Fonts Noto Sans Regular):
- Download URL: https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf

Commands (Linux/macOS):
```
mkdir -p viralstatus-backend/assets/fonts && \
curl -L -o viralstatus-backend/assets/fonts/NotoSans-Regular.ttf \
  https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf
```

Commands (Windows PowerShell):
```
New-Item -ItemType Directory -Force -Path "viralstatus-backend/assets/fonts" | Out-Null
Invoke-WebRequest -Uri "https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf" \
  -OutFile "viralstatus-backend/assets/fonts/NotoSans-Regular.ttf"
```

After adding the file, commit and redeploy so the server stops relying on system fonts.

