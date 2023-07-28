const { Client, Intents } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const speech = require('@google-cloud/speech');
const axios = require('axios');
const { chatGPT } = require('./chatGPT');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const streamifier = require('streamifier');

// Google Speech-to-Text client
const speechClient = new speech.SpeechClient({
  keyFilename: 'google-speech.json', 
});

// Transcribe function
async function transcribe(audioBuffer) {
  const audio = {
    content: audioBuffer.toString('base64'),
  };

  const config = {
    encoding: 'LINEAR16',
    sampleRateHertz: 16000,
    languageCode: 'en-US',
  };

  const request = {
    audio: audio,
    config: config,
  };

  // Detects speech in the audio file
  const [response] = await speechClient.recognize(request);
  const transcription = response.results
    .map(result => result.alternatives[0].transcript)
    .join('\n');
  return transcription;
}

// Text-to-Speech function
async function textToSpeech(text, voiceId) {
  const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/1F5rY0uw8vh6QwmIJYCP`, {
    text: text,
    model_id: "eleven_monolingual_v1",
    voice_settings: {
      stability: 0.3,
      similarity_boost: 0.75
    }
  }, {
    headers: {
      'xi-api-key': `${process.env.ELEVENLABS_API_KEY}`, // Replace with your ElevenLabs API key
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    responseType: 'arraybuffer', // This is important to receive the audio data correctly
  });

  const readable = streamifier.createReadStream(response.data);

  return readable;
}

async function execute(message, args) {
  // Check if the user is in a voice channel
  if (message.member.voice.channel) {
    const connection = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfDeaf: false, // Explicitly set selfDeaf to false
    });

    const audioPlayer = createAudioPlayer();

    connection.subscribe(audioPlayer);

    // Create an audio receiver
    const receiver = connection.receiver;

    // Handle when a user starts speaking
    receiver.speaking.on('start', (userId) => {
      console.log(`User ${userId} started speaking`); // Log when a user starts speaking

      // Subscribe to the user's audio
      const userAudioStream = receiver.subscribe(userId);

      // Create a buffer to store the audio data
      let audioBuffer = [];

      userAudioStream.on('data', (chunk) => {
        console.log('Received audio data'); // Log when new audio data is received
        audioBuffer.push(chunk);
      });

      // Add a timeout to manually end the stream after 5 seconds
      setTimeout(() => {
        userAudioStream.emit('end');
      }, 5000);

      userAudioStream.on('end', async () => {
        console.log('User audio stream ended'); // Log when the user's audio stream ends

        // Handle the audio data
        try {
          const audioData = Buffer.concat(audioBuffer);

          const transcription = await transcribe(audioData);
          console.log(`Transcription: ${transcription}`); // Log the transcription

          const response = await chatGPT(transcription); // Use the chatGPT function here
          console.log(`chatGPT response: ${response}`); // Log the chatGPT response

          const speech = await textToSpeech(response);
          console.log('Text to speech completed'); // Log when the text-to-speech is done

          const resource = createAudioResource(speech);

          audioPlayer.play(resource);
          console.log('Audio player started'); // Log when the audio player starts
        } catch (error) {
          console.error('An error occurred:', error); // Log any errors that occur
        }
      });
    });
  } else {
    message.reply('You need to join a voice channel first!');
  }
}

module.exports = {
  name: 'joinvc',
  description: 'Join a voice channel and start listening',
  execute,
  transcribe,
  textToSpeech,
};
