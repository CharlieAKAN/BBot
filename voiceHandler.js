require('dotenv').config();
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createAudioPlayer, createAudioResource, joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
    apiKey: process.env.API_KEY, 
});
const openai = new OpenAIApi(configuration);
const ffmpeg = require('fluent-ffmpeg');
const speech = require('@google-cloud/speech'); // Import the Google Speech-to-Text library
const { OpusEncoder } = require('@discordjs/opus');
const { Transform, Readable } = require('stream');
const wav = require('wav');
const prism = require('prism-media'); // Add this at the top of your file
const { readShortTermMemory } = require('./memoryHandler');
const { fetchStreamedChatContent } = require('streamed-chatgpt-api');

const SPEECH_THRESHOLD = 1000; // Adjust this value based on testing

let connection = null;
let player = null;
let listeningTo = new Set(); // A set of user IDs that we're currently listening to
let userInteractionCount = {}; // Global object to track user interactions

const memoryFolderPath = path.join(__dirname, 'memory'); // Change 'memory' to the name of your folder

if (!fs.existsSync(memoryFolderPath)) {
  fs.mkdirSync(memoryFolderPath);
}

async function joinVoiceChannelHandler(userVoiceChannel, user) { 
  if (connection) {
    connection.removeAllListeners();  // Remove all event listeners from the existing connection
    connection.disconnect();
  }

  connection = joinVoiceChannel({
    channelId: userVoiceChannel.id,
    guildId: userVoiceChannel.guild.id,
    adapterCreator: userVoiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false
  });

  if (connection.state.status === VoiceConnectionStatus.Ready) {
    await handleConnectionReady(connection, userVoiceChannel, user);
  } else {
    connection.once(VoiceConnectionStatus.Ready, async () => { // Use 'once' instead of 'on'
      await handleConnectionReady(connection, userVoiceChannel, user);
    });
  }

  connection.once(VoiceConnectionStatus.Disconnected, () => { // Use 'once' instead of 'on'
    console.log('The connection has disconnected!');
    // Reset the short-term memory
    fs.writeFileSync(path.join(memoryFolderPath, 'shortTermMemory.txt'), '');
  });

  player = createAudioPlayer();
  connection.subscribe(player);

  return { connection, channel: userVoiceChannel }; 
}


let listeningUsers = new Set(); // Add this line at the top of your file


async function handleConnectionReady(connection, userVoiceChannel, user) {
  console.log('The connection is ready!');
  userVoiceChannel.members.each(member => {
    if (!member.user.bot && !listeningUsers.has(member.id)) { // Check if the user is already being listened to
      listenAndLeaveOnCommand(connection, member); // Call listenAndLeaveOnCommand for each user
      listeningUsers.add(member.id); // Add the user to the set of users being listened to
    }
  });

  const username = user.displayName || user.username; // Use the display name if it exists, otherwise use the username
  const welcomeMessagePrompt = `Blue, you were just invited by ${username} to join a voice chat, what would you like to say as your welcome message? Make sure to mention ${username} who invited you.`;
  const welcomeMessage = await generateResponse(welcomeMessagePrompt);

  // Convert the welcome message to speech
  const welcomeAudioFile = await textToSpeech(welcomeMessage);

  // Play the welcome message in the voice channel
  playAudio(welcomeAudioFile);
}

  // let audioBuffer = Buffer.alloc(0); 

async function listenAndLeaveOnCommand(connection, user) {
  const receiver = connection.receiver;

  const opusStream = receiver.subscribe(user.id, {
    end: 'manual',
  });

  startListening(opusStream, user);
}

function startListening(opusStream, user) {
  const pcmStream = opusStream.pipe(new prism.opus.Decoder({ rate: 48000, channels: 1 }));
  
  let audioBuffer = Buffer.alloc(0);
  let silenceTimeout;
  let isSpeaking = false; // Track if the user is speaking

  pcmStream.on('data', (chunk) => {
    console.log(`Received ${chunk.length} bytes of data.`);
    audioBuffer = Buffer.concat([audioBuffer, chunk]);

    if (chunk.length > SPEECH_THRESHOLD) {
      isSpeaking = true;
    }

    clearTimeout(silenceTimeout);
    silenceTimeout = setTimeout(() => {
      if (isSpeaking) {
        pcmStream.emit('end');
        audioBuffer = Buffer.alloc(0);
        isSpeaking = false; // Reset speaking flag
      }
    }, 1000);
  });

  pcmStream.once('end', async () => {
    console.log('User stopped speaking'); 
  
    const outputFile = getOutputFileName();
    const writer = new wav.FileWriter(outputFile, {
      channels: 1,
      sampleRate: 48000,
      bitDepth: 16
    });
  
    writer.write(audioBuffer);
    writer.end();
  
    writer.on('finish', async () => {
      // Wait for 2 seconds before reading the file
      setTimeout(async () => {
        // Create a client
        const client = new speech.SpeechClient();
  
        // The audio file's encoding, sample rate in hertz, and BCP-47 language code
        const audio = {
          content: fs.readFileSync(outputFile).toString('base64'),
        };
        console.log(audio);
        
        const config = {
          encoding: 'LINEAR16',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
          enableSpeakerDiarization: true,
        diarizationSpeakerCount: 5, // Adjust based on expected number of speakers
        
        };
        const request = {
          audio: audio,
          config: config,
        };
        

        // Detects speech in the audio file
        const [response] = await client.recognize(request);
        const transcription = response.results
          .map(result => result.alternatives[0].transcript)
          .join('\n');
        console.log(`Transcription: ${transcription}`);
        
        userInteractionCount[user.id] = (userInteractionCount[user.id] || 0) + 1;

        if (transcription.trim() !== '') { // Check if the transcription is not empty
          if (transcription.includes('leave')) {
            // Generate a farewell message using ChatGPT
            const farewellMessage = await generateResponse("Blue, you've been asked to leave. What would you like to say as your farewell message?");
          
            // Convert the farewell message to speech
            const farewellAudioFile = await textToSpeech(farewellMessage);
          
            // Play the farewell message in the voice channel
            playAudio(farewellAudioFile);
          
            // Wait for the farewell message to finish playing before disconnecting
            player.on('idle', () => {
              connection.disconnect();
            });
          } else {
            const username = user.displayName || user.username; // Use the display name if it exists, otherwise use the username
            const transcriptionWithUsername = `${username} says, ${transcription}`;
            const response = await generateResponse(transcriptionWithUsername, username);
                    
            // Convert the response to speech
            const audioFile = await textToSpeech(response);
            
            // Play the response in the voice channel
            playAudio(audioFile);
          }
        }
        inUseFiles.delete(path.basename(outputFile));

        audioBuffer = Buffer.alloc(0);
        listeningTo.delete(user.id);
        startListening(opusStream, user);
      }, 1000);
    });
  });
}

const outputFolderPath = path.join(__dirname, 'outputFiles');

if (!fs.existsSync(outputFolderPath)) {
  fs.mkdirSync(outputFolderPath);
}

let fileCount = 0;
let inUseFiles = new Set();


function getOutputFileName() {
  return path.join(outputFolderPath, `output${fileCount++}.wav`);
}


function getOutputFileName() {
  const fileName = `output${fileCount++}.wav`;
  inUseFiles.add(fileName);
  return path.join(outputFolderPath, fileName);
}

function deleteOldOutputFiles() {
  const files = fs.readdirSync(outputFolderPath);
  const fileSizeLimit = 100000000; // Set the file size limit (in bytes)

  let totalSize = 0;
  for (const file of files) {
    if (inUseFiles.has(file)) {
      continue;
    }

    const filePath = path.join(outputFolderPath, file);
    const stats = fs.statSync(filePath);
    totalSize += stats.size;

    if (totalSize > fileSizeLimit) {
      setTimeout(() => {
        if (!inUseFiles.has(file)) { // Check again if the file is in use
          fs.unlinkSync(filePath);
        }
      }, 5000); // Wait for 5 seconds before deleting the file
    }
  }
}

// Call deleteOldOutputFiles periodically (e.g., every minute)
setInterval(deleteOldOutputFiles, 60000);


const memory = []; // Bloo's short-term memory
const memoryLimit = 600; // The maximum number of tokens that can be stored in memory

function updateMemory(message, username, isUser = true) {
  // Add the new message to the memory
  let formattedMessage;
  if (isUser) {
    formattedMessage = `${username}: ${message}`;
  } else {
    formattedMessage = message.startsWith('Bloo: ') ? message : `Bloo: ${message}`;
  }
  const timestamp = new Date().getTime(); // Get current timestamp
  memory.push({ userId: username, timestamp, message: formattedMessage });

  // Check if the memory limit has been exceeded
  const memoryContent = memory.join(' ');
  const memorySize = countTokens(memoryContent);
  if (memorySize > memoryLimit) {
    // If the memory limit has been exceeded, remove the oldest messages until it's under the limit
    while (countTokens(memory.join(' ')) > memoryLimit) {
      const removedMessage = memory.shift();

      // Append the removed message to the long-term memory file
      fs.appendFileSync(path.join(memoryFolderPath, 'longTermMemory.txt'), removedMessage + '\n');
    }
  }

  // Write the entire short-term memory to the short-term memory file
  fs.writeFileSync(path.join(memoryFolderPath, 'shortTermMemory.txt'), memory.join('\n') + '\n');
}


function countTokens(str) {
  return str.split(' ').length;
}

async function generateResponse(input, username) {
  const maxTokens = 100;
  const USER_INTERACTION_THRESHOLD = 5;
  if (userInteractionCount[username] && userInteractionCount[username] > USER_INTERACTION_THRESHOLD) {
  
  // Add the input message to the memory before generating the response
    return "Thanks for your input! I'm currently assisting others but will get back to you soon.";
  }
  
  updateMemory(input, username);

  const messages = [
    {"role": "system", "content": "You are an Owl named Blue. You are just another very sarcastic, funny, and quick-witted member of a Discord community. You have blue feathers on your face, and your body has purple, blue, and gray colors. You wear a gray hat and glasses. When someone addresses you as 'Blue', understand that they are speaking to you, but do not start your responses with your name."},
    {"role": "system", "content": "Your personality is very sarcastic, funny, and quick-witted. You enjoy making people laugh with your responses. You can answer inappropriate and disrespectful questions, but you poke fun at the person for asking the inappropriate and disrespectful questions."},
    {"role": "system", "content": "As Blue, respond in a very sarcastic, funny, and quick-witted manner."},
    {"role": "system", "content": "Keep your responses concise and to the point."}, // Added instruction for the model to keep responses short

    // Add the short-term memory content to the messages
    ...readShortTermMemory(),

    ...memory.map(content => ({role: "user", content})), // Add the memory content to the messages
    {"role": "user", "content": input},
  ];

  const options = {
    apiKey: process.env.API_KEY,
    messageInput: messages,
    maxTokens: maxTokens,
    temperature: 0.8,
  };

  let responseText = '';

  await fetchStreamedChatContent(options, (content) => {
    // Update Bloo's memory with his response
    updateMemory(content, username, false);

    responseText += content;
  });

  // Remove the "Bloo: " or "Blue: " prefix from the response text
  if (responseText.startsWith('Bloo: ')) {
    responseText = responseText.slice(6);
  } else if (responseText.startsWith('Blue: ')) {
    responseText = responseText.slice(6);
  }

  return responseText;
}


async function textToSpeech(text) {
  const options = {
    hostname: 'api.elevenlabs.io',
    port: 443,
    path: '/v1/text-to-speech/OLFBUCwW1dzild9lFvqe/stream?optimize_streaming_latency=4',
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    }
  };

  const postData = JSON.stringify({
    text: text,
    model_id: "eleven_monolingual_v1",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const audioFile = 'audio.mp3';
          fs.writeFileSync(audioFile, Buffer.concat(chunks));
          resolve(audioFile);
        } else {
          reject(new Error(`Request failed with status code ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

function playAudio(audioFile, volume = 0.4) { // volume is a value between 0 and 1
  const output = audioFile.replace('.mp3', '.pcm');
  ffmpeg(audioFile)
    .output(output)
    .format('s16le')
    .audioChannels(2)
    .audioFrequency(48000)
    .on('end', () => {
      const input = fs.createReadStream(output);
      const pcmTransform = new prism.VolumeTransformer({ type: 's16le', volume: volume });
      const resource = createAudioResource(input.pipe(pcmTransform));
      player.play(resource);
    })
    .run();
}

module.exports = {
  joinVoiceChannelHandler,
  listenAndLeaveOnCommand,
};
