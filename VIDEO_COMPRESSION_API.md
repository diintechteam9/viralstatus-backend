# Video Compression API Documentation

## Overview
This API provides video compression functionality with multiple quality presets and automatic cleanup of temporary files. The system uses FFmpeg for video processing and includes comprehensive job tracking and file management.

## Features
- Multiple quality presets (720p, 480p, 360p, 240p, 144p, custom)
- Real-time compression progress tracking
- Automatic cleanup of temporary files
- Job management (cancel, status, history)
- File validation and error handling
- Background processing with progress updates

## API Endpoints

### 1. Upload Video
**POST** `/api/compression/upload`

Upload a video file for compression.

**Request:**
- Content-Type: `multipart/form-data`
- Body: `video` (file)

**Response:**
```json
{
  "success": true,
  "message": "Video uploaded successfully",
  "data": {
    "jobId": "64f8a1b2c3d4e5f6a7b8c9d0",
    "originalFileName": "video.mp4",
    "fileSize": 52428800,
    "duration": 120.5,
    "dimensions": "1920x1080",
    "codec": "h264"
  }
}
```

### 2. Start Compression
**POST** `/api/compression/start`

Start video compression with specified quality.

**Request:**
```json
{
  "jobId": "64f8a1b2c3d4e5f6a7b8c9d0",
  "quality": "720p",
  "customSettings": {
    "width": 1280,
    "height": 720,
    "bitrate": "3000k",
    "crf": 20
  }
}
```

**Quality Options:**
- `720p` - High Definition (1280x720)
- `480p` - Standard Definition (854x480)
- `360p` - Medium Quality (640x360)
- `240p` - Low Quality (426x240)
- `144p` - Very Low Quality (256x144)
- `custom` - Custom settings (requires customSettings)

**Response:**
```json
{
  "success": true,
  "message": "Compression started",
  "data": {
    "jobId": "64f8a1b2c3d4e5f6a7b8c9d0",
    "quality": "720p",
    "estimatedTime": "Processing..."
  }
}
```

### 3. Get Job Status
**GET** `/api/compression/status/:jobId`

Get compression job status and progress.

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "64f8a1b2c3d4e5f6a7b8c9d0",
    "status": "processing",
    "progress": 45,
    "originalFileName": "video.mp4",
    "targetQuality": "720p",
    "originalFileSize": 52428800,
    "compressedFileSize": null,
    "compressionRatio": null,
    "processingTime": null,
    "errorMessage": null,
    "createdAt": "2023-09-15T10:30:00.000Z",
    "completedAt": null
  }
}
```

**Status Values:**
- `pending` - Job created, waiting to start
- `processing` - Compression in progress
- `completed` - Compression finished successfully
- `failed` - Compression failed
- `cancelled` - Job was cancelled

### 4. Download Compressed Video
**GET** `/api/compression/download/:jobId`

Download the compressed video file.

**Response:**
- Content-Type: `video/mp4`
- Content-Disposition: `attachment; filename="video_720p.mp4"`
- Body: Binary video file

### 5. Cancel Job
**DELETE** `/api/compression/cancel/:jobId`

Cancel an ongoing compression job.

**Response:**
```json
{
  "success": true,
  "message": "Job cancelled successfully"
}
```

### 6. Get User Jobs
**GET** `/api/compression/jobs`

Get user's compression jobs with pagination.

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10)
- `status` - Filter by status (optional)

**Response:**
```json
{
  "success": true,
  "data": {
    "jobs": [...],
    "pagination": {
      "current": 1,
      "pages": 5,
      "total": 50
    }
  }
}
```

### 7. Get Quality Presets
**GET** `/api/compression/presets`

Get available quality presets.

**Response:**
```json
{
  "success": true,
  "data": {
    "720p": {
      "name": "720p HD",
      "description": "High Definition (1280x720)",
      "bitrate": "3000k"
    },
    "480p": {
      "name": "480p SD",
      "description": "Standard Definition (854x480)",
      "bitrate": "1500k"
    },
    "360p": {
      "name": "360p",
      "description": "Medium Quality (640x360)",
      "bitrate": "800k"
    },
    "240p": {
      "name": "240p",
      "description": "Low Quality (426x240)",
      "bitrate": "400k"
    },
    "144p": {
      "name": "144p",
      "description": "Very Low Quality (256x144)",
      "bitrate": "200k"
    },
    "custom": {
      "name": "Custom",
      "description": "Custom settings",
      "bitrate": "Variable"
    }
  }
}
```

## File Cleanup

### Automatic Cleanup
The system automatically cleans up temporary files in the following scenarios:
1. After successful video download (with 1-hour delay)
2. When a job is cancelled
3. When a job fails
4. When the cleanup script is run

### Manual Cleanup
Run the cleanup script to remove old temporary files:

```bash
npm run cleanup
```

This removes files older than 24 hours from the `./temp` directory.

### Cleanup Service
The `cleanupService` provides methods for:
- Adding files to cleanup tracking
- Removing individual files or directories
- Cleaning up job-specific files
- Removing old files based on age

## Error Handling

### Common Error Responses

**File Upload Errors:**
```json
{
  "success": false,
  "message": "Unsupported file format. Supported formats: MP4, MOV, AVI, MKV, WEBM, FLV, WMV, M4V"
}
```

**Validation Errors:**
```json
{
  "success": false,
  "message": "Invalid video file: Video too short (less than 1 second)"
}
```

**Job Not Found:**
```json
{
  "success": false,
  "message": "Compression job not found"
}
```

**Compression Failed:**
```json
{
  "success": false,
  "message": "Failed to start compression",
  "error": "FFmpeg compression failed: Invalid input file"
}
```

## File Structure

```
viralstatus-backend/
├── models/
│   └── VideoCompressionJob.js          # Database model
├── controllers/
│   └── videoCompressionController.js   # API controllers
├── routes/
│   └── videoCompressionRoutes.js       # API routes
├── utils/
│   └── videoCompressionUtils.js        # Compression utilities
├── services/
│   └── cleanupService.js               # File cleanup service
├── scripts/
│   └── cleanupTempFiles.js             # Cleanup script
└── temp/
    ├── videos/                         # Uploaded videos
    └── compressed/                     # Compressed videos
```

## Usage Example

```javascript
// 1. Upload video
const formData = new FormData();
formData.append('video', videoFile);

const uploadResponse = await fetch('/api/compression/upload', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});

const { data: { jobId } } = await uploadResponse.json();

// 2. Start compression
const compressResponse = await fetch('/api/compression/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    jobId,
    quality: '720p'
  })
});

// 3. Poll for status
const checkStatus = async () => {
  const statusResponse = await fetch(`/api/compression/status/${jobId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const { data } = await statusResponse.json();
  
  if (data.status === 'completed') {
    // 4. Download compressed video
    window.open(`/api/compression/download/${jobId}`);
  } else if (data.status === 'failed') {
    console.error('Compression failed:', data.errorMessage);
  } else {
    // Still processing, check again in 2 seconds
    setTimeout(checkStatus, 2000);
  }
};

checkStatus();
```

## Security Notes

- All endpoints require authentication
- File uploads are limited to 500MB
- Only supported video formats are accepted
- Temporary files are automatically cleaned up
- Input validation prevents malicious file uploads

## Performance Considerations

- Compression runs in background to avoid blocking requests
- Progress updates are stored in database for real-time tracking
- Large files may take several minutes to process
- Consider implementing job queuing for high-volume usage
- Monitor disk space usage in temp directories
