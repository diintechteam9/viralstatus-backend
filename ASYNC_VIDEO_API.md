# Async Video Generation API Documentation

## Overview

The Async Video Generation API provides a scalable solution for generating videos without browser timeout issues. Instead of waiting for the entire video generation process, the API returns immediately with a job ID and processes the video in the background.

## Key Features

- **No Timeout Issues**: Immediate response with job ID
- **Background Processing**: Videos are generated asynchronously
- **S3 Storage**: Videos are automatically saved to S3 with organized structure
- **Progress Tracking**: Real-time progress updates
- **Job Management**: Track, cancel, and manage video generation jobs
- **User History**: View all user's video generation history

## API Endpoints

### 1. Create Async Video Generation Job

**Endpoint:** `POST /api/videocard/generate-finalvideo-async`

**Description:** Starts a new video generation job and returns immediately with a job ID.

**Request Body:**
```json
{
  "images": ["base64_image1", "base64_image2", ...],
  "audio": "base64_audio_data",
  "srt": "overlay_subtitle_srt_content",
  "imageSrt": "image_timing_srt_content", // or use "deepSrt"
  "cardName": "My Video Card",
  "category": "social-media"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Video generation started",
  "jobId": "video_1703123456789_abc123def",
  "status": "processing",
  "progress": 0,
  "cardName": "My Video Card",
  "category": "social-media",
  "estimatedTime": "2-5 minutes"
}
```

### 2. Get Job Status

**Endpoint:** `GET /api/videocard/job-status/:jobId`

**Description:** Check the status and progress of a video generation job.

**Response:**
```json
{
  "success": true,
  "jobId": "video_1703123456789_abc123def",
  "status": "completed", // pending, processing, completed, failed
  "progress": 100,
  "cardName": "My Video Card",
  "category": "social-media",
  "videoUrl": "https://your-bucket.s3.amazonaws.com/videos/social-media/my-video-card/2024-01-15T14-30-25/final_video.mp4",
  "fileName": "my-video-card_2024-01-15T14-30-25.mp4",
  "duration": 45.2,
  "formattedDuration": "0:45",
  "imageCount": 5,
  "sentenceCount": 8,
  "createdAt": "2024-01-15T14:30:25.000Z",
  "startedAt": "2024-01-15T14:30:26.000Z",
  "completedAt": "2024-01-15T14:32:15.000Z",
  "error": null
}
```

### 3. Get User's Video Jobs

**Endpoint:** `GET /api/videocard/user-jobs?limit=10&skip=0`

**Description:** Get a list of all video generation jobs for the authenticated user.

**Query Parameters:**
- `limit` (optional): Number of jobs to return (default: 10)
- `skip` (optional): Number of jobs to skip for pagination (default: 0)

**Response:**
```json
{
  "success": true,
  "jobs": [
    {
      "jobId": "video_1703123456789_abc123def",
      "status": "completed",
      "progress": 100,
      "cardName": "My Video Card",
      "category": "social-media",
      "videoUrl": "https://your-bucket.s3.amazonaws.com/videos/...",
      "fileName": "my-video-card_2024-01-15T14-30-25.mp4",
      "duration": 45.2,
      "formattedDuration": "0:45",
      "imageCount": 5,
      "sentenceCount": 8,
      "createdAt": "2024-01-15T14:30:25.000Z",
      "completedAt": "2024-01-15T14:32:15.000Z",
      "error": null
    }
  ],
  "pagination": {
    "limit": 10,
    "skip": 0,
    "total": 1
  }
}
```

### 4. Cancel Job

**Endpoint:** `DELETE /api/videocard/job/:jobId`

**Description:** Cancel a pending video generation job.

**Response:**
```json
{
  "success": true,
  "message": "Job cancelled successfully"
}
```

### 5. System Status

**Endpoint:** `GET /api/videocard/system-status`

**Description:** Get system status and active jobs information.

**Response:**
```json
{
  "success": true,
  "system": {
    "activeJobs": 2,
    "maxConcurrentJobs": 3,
    "availableSlots": 1,
    "activeJobIds": ["video_1703123456789_abc123def", "video_1703123456790_def456ghi"]
  },
  "timestamp": "2024-01-15T14:30:25.000Z"
}
```

### 6. Cleanup Old Jobs (Admin)

**Endpoint:** `POST /api/videocard/cleanup-jobs`

**Description:** Clean up old completed/failed jobs (older than 7 days).

**Response:**
```json
{
  "success": true,
  "message": "Cleaned up 15 old jobs",
  "deletedCount": 15
}
```

## S3 Storage Structure

Videos are stored in S3 with the following organized structure:

```
s3://your-bucket/videos/
├── social-media/
│   ├── my-video-card/
│   │   ├── 2024-01-15T14-30-25/
│   │   │   └── final_video.mp4
│   │   └── 2024-01-15T15-45-10/
│   │       └── final_video.mp4
│   └── another-card/
├── marketing/
│   └── product-demo/
└── educational/
    └── tutorial-series/
```

## Job Status Values

- **pending**: Job created but not yet started
- **processing**: Video generation in progress
- **completed**: Video generated successfully and saved to S3
- **failed**: Video generation failed with error details

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information"
}
```

## Frontend Integration Example

```javascript
// 1. Start video generation
const startVideoGeneration = async (videoData) => {
  try {
    const response = await fetch('/api/videocard/generate-finalvideo-async', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        ...videoData,
        cardName: 'My Video',
        category: 'social-media'
      })
    });
    
    const result = await response.json();
    if (result.success) {
      return result.jobId;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Failed to start video generation:', error);
    throw error;
  }
};

// 2. Poll for job status
const pollJobStatus = async (jobId) => {
  try {
    const response = await fetch(`/api/videocard/job-status/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const result = await response.json();
    if (result.success) {
      return result;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Failed to get job status:', error);
    throw error;
  }
};

// 3. Complete workflow
const generateVideoAsync = async (videoData) => {
  try {
    // Start the job
    const jobId = await startVideoGeneration(videoData);
    console.log('Video generation started:', jobId);
    
    // Poll for completion
    const pollInterval = setInterval(async () => {
      try {
        const status = await pollJobStatus(jobId);
        
        // Update UI with progress
        updateProgressBar(status.progress);
        updateStatusMessage(status.status);
        
        if (status.status === 'completed') {
          clearInterval(pollInterval);
          showVideoResult(status.videoUrl);
        } else if (status.status === 'failed') {
          clearInterval(pollInterval);
          showError(status.error);
        }
      } catch (error) {
        clearInterval(pollInterval);
        showError('Failed to check job status');
      }
    }, 3000); // Poll every 3 seconds
    
  } catch (error) {
    showError('Failed to start video generation');
  }
};
```

## Database Schema

The `VideoJob` model stores all job information:

```javascript
{
  jobId: String,           // Unique job identifier
  status: String,          // pending, processing, completed, failed
  progress: Number,        // 0-100
  cardName: String,        // User-provided card name
  category: String,        // Video category
  s3Key: String,          // S3 object key
  s3Url: String,          // Public S3 URL
  fileName: String,       // Generated filename
  fileSize: Number,       // File size in bytes
  duration: Number,       // Video duration in seconds
  audioDuration: Number,  // Audio duration in seconds
  imageCount: Number,     // Number of images used
  sentenceCount: Number,  // Number of sentences
  userId: ObjectId,       // User who created the job
  error: Object,          // Error details if failed
  startedAt: Date,        // When processing started
  completedAt: Date,      // When processing completed
  createdAt: Date,        // When job was created
  updatedAt: Date         // Last update time
}
```

## Performance Considerations

- **Concurrent Jobs**: Maximum 3 concurrent video generations
- **Job Cleanup**: Old jobs are automatically cleaned up after 7 days
- **Memory Management**: Temporary files are cleaned up after each job
- **S3 Storage**: Videos are stored with public read access for direct viewing

## Migration from Synchronous API

The original synchronous endpoint `/api/videocard/generate-finalvideo` is still available for backward compatibility. To migrate:

1. Replace the synchronous call with the async job creation
2. Implement polling logic to check job status
3. Handle the video URL from the completed job instead of base64 data
4. Add progress indicators and better error handling

This new async system completely eliminates CORS timeout issues and provides a much better user experience.
