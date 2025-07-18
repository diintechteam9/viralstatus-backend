const axios = require('axios');

const API_KEY = process.env.YOUTUBE_API_KEY;

async function getYoutubeStats(videoId) {
  try {
    if (!API_KEY) {
      console.error('YouTube API key is missing!');
      return { views: '-', likes: '-', comments: '-' };
    }
    if (!videoId) {
      console.error('No videoId provided to getYoutubeStats');
      return { views: '-', likes: '-', comments: '-' };
    }
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${API_KEY}`;
    const response = await axios.get(url);
    const stats = response.data.items[0]?.statistics || {};
    return {
      views: stats.viewCount || '0',
      likes: stats.likeCount || '0',
      comments: stats.commentCount || '0',
    };
  } catch (error) {
    console.error('YouTube API error for videoId', videoId, error);
    return { views: '0', likes: '0', comments: '0' };
  }
}

module.exports = getYoutubeStats; 