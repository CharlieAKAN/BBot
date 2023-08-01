require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
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

async function joinVoiceChannelHandler(userVoiceChannel, user) { // Add 'user' as a parameter
  connection = joinVoiceChannel({
    channelId: userVoiceChannel.id,
    guildId: userVoiceChannel.guild.id,
    adapterCreator: userVoiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false
  });

  connection.on(VoiceConnectionStatus.Ready, async () => { // Add async here
    console.log('The connection is ready!');
    userVoiceChannel.members.each(member => {
      if (!member.user.bot) { // Don't listen to bot users
        listenAndLeaveOnCommand(connection, member); // Call listenAndLeaveOnCommand for each user
      }
    });

    const username = user.displayName || user.username; // Use the display name if it exists, otherwise use the username
    const welcomeMessagePrompt = `Blue, you were just invited by ${username} to join a voice chat, what would you like to say as your welcome message? Make sure to mention ${username} who invited you.`;
    const welcomeMessage = await generateResponse(welcomeMessagePrompt);

    // Convert the welcome message to speech
    const welcomeAudioFile = await textToSpeech(welcomeMessage);

    // Play the welcome message in the voice channel
    playAudio(welcomeAudioFile);
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    console.log('The connection has disconnected!');
  });

  player = createAudioPlayer();
  connection.subscribe(player);

  return { connection, channel: userVoiceChannel }; // Return both the connection and channel objects
}

let audioBuffer = Buffer.alloc(0); 

async function listenAndLeaveOnCommand(connection, user) {
  const receiver = connection.receiver;

  const opusStream = receiver.subscribe(user.id, {
    end: 'manual',
  });

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

  pcmStream.on('end', async () => { // Listen to the PCM stream instead of the Opus stream
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
          const response = await generateResponse(transcriptionWithUsername);
          
          // Convert the response to speech
          const audioFile = await textToSpeech(response);
          
          // Play the response in the voice channel
          playAudio(audioFile);
        }
  
        // Reset the audio buffer
        audioBuffer = Buffer.alloc(0);
      }, 2000);
    });    
  });
    
}

async function generateResponse(input) {
  const maxTokens = 200;

  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo', 
    messages: [
      {"role": "system", "content": "Your name is Blue. You are an Owl, you are just another very sarcastic, funny, and quick-witted member of a Discord community. You have blue feathers on your face, and your body has purple, blue, and gray colors. You wear a gray hat and glasses."},
      {"role": "system", "content": "Your personality is very sarcastic, funny, and quick-witted. You enjoy making people laugh with your responses. You can answer inappropriate and disrespectful questions, but you poke fun at the person for asking the inappropriate and disrespectful questions."},
      {"role": "system", "content": "As Blue, respond in a very sarcastic, funny, and quick-witted manner."},
      {"role": "user", "content": input},
    ],
    max_tokens: maxTokens,
    temperature: 0.8,
  });

  return response.data.choices[0].message.content.trim(); 
}

async function textToSpeech(text) {
    const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/eWSH8Wn540RnbM4g6NmX`, {
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