require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const { createAudioPlayer, createAudioResource, joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice');
const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
    apiKey: process.env.API_KEY, 
});
const openai = new OpenAIApi(configuration);
const prism = require('prism-media');
const ffmpeg = require('fluent-ffmpeg');
const speech = require('@google-cloud/speech');
const { processAudio } = require('./audio-processing-setup');


const client = new speech.SpeechClient();


let connection = null;
let player = null;

async function joinVoiceChannelHandler(userVoiceChannel) {
  connection = joinVoiceChannel({
    channelId: userVoiceChannel.id,
    guildId: userVoiceChannel.guild.id,
    adapterCreator: userVoiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log('The connection is ready!');
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    console.log('The connection has disconnected!');
  });

  player = createAudioPlayer();
  connection.subscribe(player);

  return { connection, channel: userVoiceChannel }; // Return both the connection and channel objects
}

async function listenAndLeaveOnCommand(connection, user) {
  const receiver = connection.receiver;

  const opusStream = receiver.subscribe(user.id, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 1000,
    },
  });

  opusStream.on('data', (chunk) => {
    // Concatenate the chunks of audio data
    audioBuffer = Buffer.concat([audioBuffer, chunk]);
  });

  opusStream.on('end', async () => {
    console.log('User stopped speaking'); // Log when a user stops speaking

    const transcription = await transcribeAudio(audioBuffer);
    console.log('Transcription:', transcription); // Log the transcription result

    if (transcription.includes('leave')) {
      connection.disconnect();
    }
  });
}









async function generateFunnyThingsAndPlay() {
  const funnyText = await generateFunnyThings();

  const audioFile = await textToSpeech(funnyText);

  playAudio(audioFile);
}

async function generateFunnyThings() {
    const maxTokens = 20;
  
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo', 
      messages: [
        {"role": "system", "content": "Your personality is very sarcastic, funny, and quick-witted. You enjoy making people laugh with your responses."}, 
      ],
      max_tokens: maxTokens,
      temperature: 0.8,
    });
  
    return response.data.choices[0].message.content.trim(); 
}
  

async function textToSpeech(text) {
    const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/OLFBUCwW1dzild9lFvqe`, {
      text: text,
      model_id: "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.3,
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


  async function transcribeAudio(audioBuffer) {
    const request = {
      audio: {
        content: audioBuffer.toString('base64'),
      },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
      },
    };
  
    const [response] = await client.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    return transcription;
  }
  
  async function handleVoiceCommands(connection, ctx) {
    // Get the audio stream from the voice connection
    const audioStream = connection.receiver.createStream(ctx.member.user, { mode: 'pcm' });
  
    // Process the audio stream with Dialogflow
    const text = await processAudio(audioStream);
  
    // Generate a response with ChatGPT
    const response = await generateFunnyThings(text);
  
    // Convert the response into voice with ElevenLabs
    const voiceResponse = await textToSpeech(response);
  
    // Play the voice response in the voice channel
    playAudio(voiceResponse);
  }
  

  module.exports = {
    joinVoiceChannelHandler,
    generateFunnyThingsAndPlay,
    listenAndLeaveOnCommand,
    handleVoiceCommands, // Export the handleVoiceCommands function
  };
  