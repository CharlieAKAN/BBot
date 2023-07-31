const dialogflow = require('@google-cloud/dialogflow');
const uuid = require('uuid');

// You should replace 'your-project-id' with your Dialogflow project ID
const projectId = 'gmail-266806';

// Create a new session
const sessionId = uuid.v4();
const sessionClient = new dialogflow.SessionsClient();
const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionId);

async function detectAudioIntent(inputAudio, encoding, sampleRateHertz) {
  // The audio query request
  const request = {
    session: sessionPath,
    queryInput: {
      audioConfig: {
        audioEncoding: encoding,
        sampleRateHertz: sampleRateHertz,
        languageCode: 'en-US',
      },
    },
    inputAudio: inputAudio,
  };

  // Send the request to Dialogflow and get the response
  const responses = await sessionClient.detectIntent(request);
  const result = responses[0].queryResult;

  return result.fulfillmentText;
}

module.exports = { detectAudioIntent };
