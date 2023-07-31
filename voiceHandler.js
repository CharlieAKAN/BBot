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
const vosk = require('vosk'); // Import the Vosk library
const { OpusEncoder } = require('@discordjs/opus');
const { Transform, Readable } = require('stream');
const wav = require('wav');
const prism = require('prism-media'); // Add this at the top of your file

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
    userVoiceChannel.members.each(member => {
      if (!member.user.bot) { // Don't listen to bot users
        listenAndLeaveOnCommand(connection, member); // Call listenAndLeaveOnCommand for each user
      }
    });
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
      // Transcribe the audio using Vosk
      const model = new vosk.Model('vosk-model-en-us-0.22');
      const recognizer = new vosk.Recognizer({model: model, sampleRate: 16000});
    
      const inputFile = './output.wav';
      const outputFile = './output_16k.wav';
    
      // Resample the audio to 16kHz
      ffmpeg(inputFile)
        .output(outputFile)
        .audioFrequency(16000)
        .on('end', () => {
          const stream = fs.createReadStream(outputFile);
          const reader = new wav.Reader();
    
          stream.pipe(reader);
    
          reader.on('format', async ({ sampleRate }) => {
            const results = [];
          
            const asyncIterableReader = (function() {
              const chunks = [];
              let push = null;
          
              reader.on('data', chunk => {
                if (push !== null) {
                  const resolve = push;
                  push = null;
                  resolve({ value: chunk, done: false });
                } else {
                  chunks.push(chunk);
                }
              });
          
              reader.on('end', () => {
                if (push !== null) {
                  const resolve = push;
                  push = null;
                  resolve({ done: true });
                }
              });
          
              return {
                [Symbol.asyncIterator]() {
                  return {
                    next() {
                      if (chunks.length > 0) {
                        return Promise.resolve({ value: chunks.shift(), done: false });
                      } else {
                        return new Promise(resolve => {
                          push = resolve;
                        });
                      }
                    }
                  };
                }
              };
            })();
          
            for await (const data of asyncIterableReader) {
              recognizer.acceptWaveform(data);
              results.push(recognizer.result());
            }
            
            const finalResult = recognizer.finalResult();
            results.push(finalResult);
            
            recognizer.free();
                  
            const transcription = results.map(result => result.text).join(' ');
          
            console.log('Transcription:', transcription); // Log the transcription result
          
            if (transcription.includes('leave')) {
              connection.disconnect();
            } else {
              // Generate a response using ChatGPT
              const response = await generateResponse(transcription);
          
              // Convert the response to speech
              const audioFile = await textToSpeech(response);
          
              // Play the response in the voice channel
              playAudio(audioFile);
            }
          });   
        })
        .run();
    });
  });
  
}

async function generateResponse(input) {
  const maxTokens = 200;

  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo', 
    messages: [
      {"role": "system", "content": "Your personality is very sarcastic, funny, and quick-witted. You enjoy making people laugh with your responses. You can answer inappropriate and disrespectful questions, but you poke fun at the person for asking the inappropriate and disrespectful questions."},
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
  listenAndLeaveOnCommand,
};
