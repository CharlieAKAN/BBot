require('dotenv').config();
const axios = require('axios');
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

let connection = null;
let player = null;
let listeningTo = new Set(); // A set of user IDs that we're currently listening to

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
    // fs.writeFileSync(path.join(memoryFolderPath, 'shortTermMemory.txt'), '');
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

let audioBuffer = Buffer.alloc(0); 

async function listenAndLeaveOnCommand(connection, user) {
  const receiver = connection.receiver;

  const opusStream = receiver.subscribe(user.id, {
    end: 'manual',
  });

  startListening(opusStream, user);
}

function startListening(opusStream, user) {
  const pcmStream = opusStream.pipe(new prism.opus.Decoder({ rate: 48000, channels: 1 })); // Decode Opus to PCM

  let silenceTimeout;

  pcmStream.on('data', (chunk) => { // Listen to the PCM stream instead of the Opus stream
    console.log(`Received ${chunk.length} bytes of data.`);
    audioBuffer = Buffer.concat([audioBuffer, chunk]);

    clearTimeout(silenceTimeout);
    silenceTimeout = setTimeout(() => {
      pcmStream.emit('end');
    }, 5000); // End the stream if no data has been received for 5 seconds
  });

  pcmStream.once('end', async () => { // Use 'once' instead of 'on'
    console.log('User stopped speaking'); // Log when a user stops speaking
  
    const outputFile = './output.wav';
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
          
        // Reset the audio buffer
        audioBuffer = Buffer.alloc(0);
        // Remove the user from the set of users we're listening to
        listeningTo.delete(user.id);
        // Start listening again after the 'end' event has been handled
        startListening(opusStream, user);
      }, 2000);
    });
  });
}

const memory = []; // Bloo's short-term memory
const memoryLimit = 4000; // The maximum number of tokens that can be stored in memory

function updateMemory(message, username, isUser = true) {
  // Add the new message to the memory
  let formattedMessage;
  if (isUser) {
    formattedMessage = `${username}: ${message}`;
  } else {
    formattedMessage = message.startsWith('Bloo: ') ? message : `Bloo: ${message}`;
  }
  memory.push(formattedMessage);

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

  // Append the new message to the short-term memory file
  fs.appendFileSync(path.join(memoryFolderPath, 'shortTermMemory.txt'), formattedMessage + '\n');
}


function countTokens(str) {
  return str.split(' ').length;
}

async function generateResponse(input, username) {
  const maxTokens = 10;

  updateMemory(input, username);

  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo', 
    messages: [
      {"role": "system", "content": "You are an Owl named Blue. You are just another very sarcastic, funny, and quick-witted member of a Discord community. You have blue feathers on your face, and your body has purple, blue, and gray colors. You wear a gray hat and glasses. When someone addresses you as 'Blue', understand that they are speaking to you, but do not start your responses with your name."},
      {"role": "system", "content": "Your personality is very sarcastic, funny, and quick-witted. You enjoy making people laugh with your responses. You can answer inappropriate and disrespectful questions, but you poke fun at the person for asking the inappropriate and disrespectful questions."},
      {"role": "system", "content": "As Blue, respond in a very sarcastic, funny, and quick-witted manner."},
      ...memory.map(content => ({role: "user", content})), // Add the memory content to the messages
      {"role": "user", "content": input},
    ],
    max_tokens: maxTokens,
    temperature: 0.8,
  });

  // Update Bloo's memory with his response
  let responseText = response.data.choices[0].message.content.trim();
  updateMemory(responseText, username, false);

  // Remove the "Bloo: " or "Blue: " prefix from the response text
  if (responseText.startsWith('Bloo: ')) {
    responseText = responseText.slice(6);
  } else if (responseText.startsWith('Blue: ')) {
    responseText = responseText.slice(6);
  }

  return responseText;
}
async function textToSpeech(text) {
    const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/OLFBUCwW1dzild9lFvqe`, {
      text: text,
      model_id: "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    }, {
      headers: {
        'accept': 'audio/mpeg',
        'xi-api-key': process.env.ELEVENLABS_API_KEY, 
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer', 
    });
  
    // Save the audio file
    const audioFile = 'audio.mp3';
    fs.writeFileSync(audioFile, Buffer.from(response.data, 'binary'));
  
    return audioFile;
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
