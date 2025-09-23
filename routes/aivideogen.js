const express=require('express');
const router=express.Router();

// crud for the video cards 
const {videocard,getallvideocard,getallvideocardById,updatevideocard,deletevideocard}=require('../controllers/aivideogen/videocardcontroller');

// for deepragam 
const {getSrtFromAudio}=require('../controllers/aivideogen/deepgramsentencesrtcontroller');
const {generateSRT}=require('../controllers/aivideogen/deepgramwordsrtcontroller');

// for final video
const {generateFinalVideo}=require('../controllers/aivideogen/generatefinalvideocontroller');

// for async video generation
const {
  createAsyncVideoJob,
  getJobStatus,
  getUserJobs,
  getCardJobs,
  refreshCardUrls,
  cancelJob,
  getSystemStatus,
  cleanupOldJobs
} = require('../controllers/aivideogen/asyncVideoController');

// for image generation 
const {generateImage}=require('../controllers/aivideogen/generateimagecontroller');

// for image prompt 
const {generatePrompt}=require('../controllers/aivideogen/generatepromptforimage');

// for image to video using the prompt pixverse 
const {generateVideo}=require('../controllers/aivideogen/pixverseimagetovideocontroller');

// for image to video using the prompt veo 
const {veoImageToVideo}=require('../controllers/aivideogen/veoimagetovideocontroller');

// for tts 
const {textToSpeech1}=require('../controllers/aivideogen/ttselevenlabscontroller');
const {textToSpeech2}=require('../controllers/aivideogen/ttslmntcontroller');



router.post('/videocard',videocard);
router.get('/videocard',getallvideocard);
router.get('/videocard/:id',getallvideocardById);
router.put('/videocard/:id',updatevideocard);
router.delete('/videocard/:id',deletevideocard);


router.post('/sentenceSRT',getSrtFromAudio);   // for sentence srt 
router.post('/wordSRT',generateSRT);  // for word srt 
router.post('/generate-finalvideo',generateFinalVideo);  // for final video (synchronous - legacy)
router.post('/generate-finalvideo-async',createAsyncVideoJob);  // for async video generation
router.get('/job-status/:jobId',getJobStatus);  // get job status
router.get('/user-jobs',getUserJobs);  // get user's video jobs
router.get('/card-jobs/:cardId',getCardJobs);  // get card's video jobs (history)
router.post('/refresh-urls/:cardId',refreshCardUrls);  // refresh S3 URLs for card jobs
router.delete('/job/:jobId',cancelJob);  // cancel a job
router.get('/system-status',getSystemStatus);  // get system status
router.post('/cleanup-jobs',cleanupOldJobs);  // cleanup old jobs (admin)
router.post('/generate-image',generateImage);  // for image generation 
router.post('/generate-prompt',generatePrompt);  // for image prompt 
router.post('/generate-video-pixverse',generateVideo);  // for image to video using the prompt pixverse
router.post('/generate-video-veo',veoImageToVideo);  // for image to video using the prompt veo
router.post('/elevenlabs',textToSpeech1);  // for tts using elevenlabs 
router.post('/lmnt',textToSpeech2);  // for tts using lmnt 


module.exports=router;
