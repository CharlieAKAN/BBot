const { v1p3beta1 } = require('@google-cloud/video-intelligence');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const axios = require('axios'); // Install axios if you haven't: npm install axios
const { GOOGLE_APPLICATION_CREDENTIALS, GCS_BUCKET_NAME } = process.env;

const videoIntelligenceClient = new v1p3beta1.VideoIntelligenceServiceClient({
  keyFilename: path.join(__dirname, GOOGLE_APPLICATION_CREDENTIALS),
});

const storage = new Storage({
  keyFilename: path.join(__dirname, GOOGLE_APPLICATION_CREDENTIALS),
});
async function uploadVideoToGCS(videoUrl) {
    const response = await axios.get(videoUrl, { responseType: 'stream' });
    const contentType = response.headers['content-type'];
    const file = storage.bucket(GCS_BUCKET_NAME).file(`${Date.now()}.${contentType.split('/')[1]}`);
    const writeStream = file.createWriteStream({ contentType });
  
    return new Promise((resolve, reject) => {
      response.data
        .pipe(writeStream)
        .on('error', (error) => reject(error))
        .on('finish', () => resolve(`gs://${GCS_BUCKET_NAME}/${file.name}`));
    });
  }

async function analyzeVideo(videoUrl) {
    const gcsVideoUrl = await uploadVideoToGCS(videoUrl);
  
    const request = {
      inputUri: gcsVideoUrl,
      features: [
        'LABEL_DETECTION',
        'SHOT_CHANGE_DETECTION',
        'SPEECH_TRANSCRIPTION',
        'OBJECT_TRACKING',
        'TEXT_DETECTION',
      ],
      videoContext: {
        speechTranscriptionConfig: {
          languageCode: 'en-US', // Set the language code according to your needs
          enableAutomaticPunctuation: true,
          maxAlternatives: 5, // Set the number of transcription alternatives
          filterLevel: 'LOW', // Set the filter level to get more transcriptions
          speechContexts: [
            {
              phrases: [
                'Sea of Thieves',
                'bring up the sails',
                'keg',
                'drop the anchor',
                'ship',
                'reaper',
                'emissary',
              ],
            },
          ], // Add relevant phrases to help the API better understand the speech
        },
      },
    };
  
    const [operation] = await videoIntelligenceClient.annotateVideo(request);
    const results = await operation.promise();
  
    const annotations = results[0].annotationResults[0];
    console.log('Raw annotations:', annotations); // Add this line to log the raw annotations
    const labels = annotations.segmentLabelAnnotations.map(
      (annotation) => annotation.entity.description
    );
    const shotChanges = annotations.shotAnnotations.length;
    const transcriptions = annotations.speechTranscriptions.map(
      (transcription) => transcription.alternatives[0].transcript
    );
    const objectAnnotations = annotations.objectAnnotations.map(
      (objectAnnotation) => objectAnnotation.entity.description
    );
    const textAnnotations = annotations.textAnnotations.map(
      (textAnnotation) => textAnnotation.text
    );
  
    return {
      labels,
      shotChanges,
      transcriptions,
      objectAnnotations,
      textAnnotations,
    };
  }
  
  module.exports = {
    analyzeVideo,
  };
  