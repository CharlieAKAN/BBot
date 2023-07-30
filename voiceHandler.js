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
}

async function generateFunnyThingsAndPlay() {
  const funnyText = await generateFunnyThings();

  const audioFile = await textToSpeech(funnyText);

  playAudio(audioFile);
}

async function generateFunnyThings() {
    const maxTokens = 100;
  
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

module.exports = {
    joinVoiceChannelHandler,
    generateFunnyThingsAndPlay,
  };
