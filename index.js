require('dotenv/config');
const { Client, IntentsBitField, ActivityType, EmbedBuilder } = require('discord.js');
const { chatGPT, openai } = require('./chatGPT');
const { filterMessages, buildConversationLog } = require('./messageUtils');
const { handleVideoLinks } = require('./videoLinkHandler');
const youtubeHandler = require('./youtubeHandler');
const imageHandler = require('./imageHandler');
const gifHandler = require('./gifHandler');
const stringifySafe = require('json-stringify-safe');
const { analyzeVideo } = require('./videoIntelligence');
const util = require('util');
const fs = require('fs');
const crewmates = require('./crewmates');
const voiceStateUpdate = require('./voiceChannelJoin');


let imageDescriptionMap = new Map();

async function generateGifQuery(prompt) {
  const response = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: "Generate a very detailed search query for a GIF related to the text from the user. Make sure the GIF you send is related to the text from the person who sent it. Be very human about how you select the gif and make sure it fit within the message the user sent you." },
      { role: "user", content: prompt }
    ],
    max_tokens: 10,
    temperature: 0.5,
  });

  console.log('Gif Query API Response:', stringifySafe(response, null, 2));

  if (response.data.choices && response.data.choices.length > 0) {
    return response.data.choices[0].message.content.trim();
  } else {
    console.error('No choices found in the response');
    return '';
  }
}

function calculateScore(videoAnalysis, keywords) {
  let score = 0;

  for (const keyword of keywords) {
    const keywordMatches = videoAnalysis.labels.filter(label => label.toLowerCase() === keyword.toLowerCase()).length;
    score += keywordMatches;
  }

  return score;
}

function countMatches(array1, array2) {
  let count = 0;
  array1.forEach(item1 => {
    array2.forEach(item2 => {
      if (item1.toLowerCase() === item2.toLowerCase()) {
        count++;
      }
    });
  });
  return count;
}

function filterForbiddenWords(inputArray, forbiddenWords) {
  return inputArray.filter(word => {
    const wordLower = word.toLowerCase();

    return !forbiddenWords.some(forbiddenWord => {
      if (typeof forbiddenWord === 'string') {
        return forbiddenWord.toLowerCase() === wordLower;
      } else if (forbiddenWord instanceof RegExp) {
        return forbiddenWord.test(word);
      }
      return false;
    });
  });
}


function detectGame(videoAnalysis) {
  if (!videoAnalysis) return null;

  // Define game-specific keywords or phrases
  const games = {
    'Sea of Thieves': {
      labels: ['pirate', 'sea of thieves', 'ship', 'sailing', 'treasure', 'ocean', 'island', 'kraken', 'skeleton', 'combat', 'adventure', 'cannon', 'fishing', 'exploration'],
      objects: ['swimwear','kite','food barrel','guardian of athena/s Fortune','boat','outpost','emissary','pirate ship', 'treasure chest', 'skeleton', 'skeletons', 'cannon', 'spyglass', 'sail', 'anchor', 'cutlass', 'flintlock', 'compass', 'fishing rod', 'trident', 'rowboat'],
      texts: ['lantern','food barrel','guardian of athena/s fortune','boat','unload cannonball','loading chainshot','load cannonball','outpost','emissary','damned','milestone','dark star','cannonball','sail', 'anchor', 'plunder', 'treasure', 'voyage', 'bounty', 'skull', 'fort', 'crews', 'outpost', 'alliance', 'reaper', 'merchant', 'order of souls', 'gold hoarders'],
      transcriptions: ['guardian of athena/s fortune','boat','ship','skeleton','kraken','pirate','sea of thieves','treasure','cannon balls','outpost','emissary','bring up the sails','sails', 'keg', 'fort', 'damnned', 'drop the anchor', 'reaper'], // Add speech transcription keywords here
      },
    // Add more games here with their keywords, objects, and texts
  };

  const forbiddenWords = ['coryallen','thecypherian','the cypherian','mik3mik3baby','FOLLOW','gifted', 'ping', 'fps', /\d+/];


  const weights = {
    labels: 4,
    objects: 3,
    texts: 1,
    transcriptions: 2, // Add a weight for transcriptions
  };

  let highestScore = 0;
  let detectedGame = null;

  // Iterate through the games and their keywords
  if (videoAnalysis.labels) {
    videoAnalysis.labels = filterForbiddenWords(videoAnalysis.labels, forbiddenWords);
  }

  if (videoAnalysis.objectAnnotations) {
    videoAnalysis.objectAnnotations = filterForbiddenWords(videoAnalysis.objectAnnotations, forbiddenWords);
  }

  if (videoAnalysis.textAnnotations) {
    videoAnalysis.textAnnotations = filterForbiddenWords(videoAnalysis.textAnnotations, forbiddenWords);
  }

  if (videoAnalysis.transcriptions) {
    videoAnalysis.transcriptions = filterForbiddenWords(videoAnalysis.transcriptions, forbiddenWords);
  }

  // Iterate through the games and their keywords
  for (const game in games) {
    const { labels, objects, texts, transcriptions } = games[game];
    let score = 0;

    if (videoAnalysis.labels) {
      score += countMatches(videoAnalysis.labels, labels) * weights.labels;
    }
    
    if (videoAnalysis.objectAnnotations) {
      score += countMatches(videoAnalysis.objectAnnotations, objects) * weights.objects;
    }
    
    if (videoAnalysis.textAnnotations) {
      score += countMatches(videoAnalysis.textAnnotations, texts) * weights.texts;
    }

    if (videoAnalysis.transcriptions) {
      score += countMatches(videoAnalysis.transcriptions, transcriptions) * weights.transcriptions;
    }
    
    if (score > highestScore) {
      highestScore = score;
      detectedGame = game;
    }
  }

  return detectedGame;
}


const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers, 
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildVoiceStates
  ],
});

let blooActivated = false;
let messageCount = 0;
let timeout;

let status = [
  {
    name: 'Your Mom',
    type: ActivityType.Streaming,
    url: 'https://www.twitch.tv/StorytellersApocalypse'
  },
  {
    name: 'With Your Emotions',
    type: ActivityType.Playing,
  },
  {
    name: 'You',
    type: ActivityType.Watching,
  },
  {
    name: 'v2.4',
    type: ActivityType.Playing,
  },
];

const setRandomStatus = () => {
  let random = Math.floor(Math.random() * status.length);
  client.user.setActivity(status[random]);
};

//const startCheckingForNewThreads = require('./threads.js');
//startCheckingForNewThreads(client);


client.on('ready', () => {
  setRandomStatus(); // Set the status immediately when the bot is online
  setInterval(setRandomStatus, 3600000); // Change the status every hour (3600000 milliseconds)
  
  youtubeHandler(client);
  setInterval(() => youtubeHandler(client), 600000);

  console.log('The bot is online!');
});


client.on('messageCreate', async (message) => {
  const videoLinkMoved = await handleVideoLinks(message);
  if (!filterMessages(message, client, blooActivated, imageDescriptionMap) || videoLinkMoved) return;
  
  // Check if the keyword "bloo" is in the message and set blooActivated to true
  if (message.content.toLowerCase().includes('bloo')) {
    blooActivated = true;
    messageCount = 0;
  }

  // Analyze images even when Bloo is not activated
  if (message.attachments.size > 0) {
    const attachment = message.attachments.first();
    if (attachment.contentType.startsWith('image/')) {
      try {
        const imageDescription = await imageHandler.analyzeImage(attachment.url);
        imageDescriptionMap.set(message.id, imageDescription);
        console.log('Image analysis result:', imageDescription);
         console.log('Current imageDescriptionMap:', imageDescriptionMap); // Add this line
      } catch (error) {
        console.log('Image analysis error:', error);
      }
    }
  }

  // If Bloo is not activated, just return
  if (!blooActivated) {
    return;
  }

  try {
    await message.channel.sendTyping();

    let prevMessages = await message.channel.messages.fetch({ limit: 5 });
    prevMessages.reverse();

    const conversationLog = buildConversationLog(prevMessages, client, imageDescriptionMap, 5);

    const maxMessageCount = 5;
    const maxIdleTime = 3 * 60 * 1000; // 5 minutes
    let customRole = null;
    let replySent = false; // Add this line
    
    let videoUrl = null;
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      if (attachment.contentType.startsWith('video/')) {
        videoUrl = attachment.url;
      }
    }

    console.log('Detected video URL:', videoUrl);

    if (videoUrl) {

      await message.reply("Oh look, a video! Let me take a look...");

      // Code for processing videoUrl
      try {
        const videoAnalysis = await analyzeVideo(videoUrl);
        fs.writeFileSync('objectAnnotations.txt', videoAnalysis.objectAnnotations.join('\n'), 'utf-8');
        fs.writeFileSync('textAnnotations.txt', videoAnalysis.textAnnotations.join('\n'), 'utf-8');
        
        const detectedGame = detectGame(videoAnalysis);
        const gamePrompt = detectedGame
        ? `Bloo, a user has shared a ${detectedGame} video, and it seems to involve ${videoAnalysis.textAnnotations.join(', ')} and ${videoAnalysis.transcriptions.join(', ')} and ${videoAnalysis.objectAnnotations.join(', ')} and ${videoAnalysis.labels.join(', ')}. Please comment on it in a very human, natural, sassy, and sarcastic way. If the video is gameplay it might have Twitch streamers in it so make sure to be supportive but give a sassy and sarcastic take on what's happening in the video. Don't go into detail about the video and avoid using keywords in your reply to the user. If you think the video is a Sea of Thieves video make a general comment about how fun Sea of Thieves is. You don't need to go into great detail about the video`
        : `Bloo, a user has shared a video, and it appears to be about ${videoAnalysis.textAnnotations.join(', ')} and ${videoAnalysis.transcriptions.join(', ')} and ${videoAnalysis.objectAnnotations.join(', ')} and ${videoAnalysis.labels.join(', ')}. Please comment on it in a very human, natural, sassy, and sarcastic way. If the video is gameplay it might have Twitch streamers in it so make sure to be supportive but give a sassy and sarcastic take on what's happening in the video. Don't go into detail about the video and avoid using keywords in your reply to the user. If you think the video is a Sea of Thieves video make a general comment about how fun Sea of Thieves is. You don't need to go into great detail about the video`;
              const videoReply = await chatGPT([{ role: "user", content: gamePrompt }]);
        message.reply(videoReply);
        replySent = true;

      } catch (error) {
        console.log('Video analysis error:', error);
      }
    } else if (message.attachments.size > 0) {
      // Code for processing image attachments
      const imageDescription = imageDescriptionMap.get(message.id);
      if (imageDescription) {
        const query = `Bloo, a user has shared an image that appears to be about ${imageDescription.labels}. You also detected the following objects: ${imageDescription.objects}. ${imageDescription.faces} The detected text on the image is: "${imageDescription.texts}". Please comment on it in a very human, natural, sassy, and sarcastic way. You don't need to breakdown the image, just comment on it to the user. If you think the image is a meme make sure to seperate the text from the image. If it is a meme it is the text is funny, you don't need to talk about the font. Not all images with text on them is a meme. Feel free to use emojis from time to time. The meme is likely not about the user themselves, but about something else. Do not send any links or gifs of any kind.If a user sends a gif or link make sure not to mention the link and just comment on the gif or link.`;
        const imageReply = await chatGPT(query);
        message.reply(imageReply);
        replySent = true;
      }
    } else {
        if (!replySent) { // Add this line
        messageCount++;
    
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
          blooActivated = false;
          customRole = 'Bloo is now Flying Away. The user can bring back Bloo by using the keyword.';
        }, maxIdleTime);
    
        if (messageCount >= maxMessageCount) {
          blooActivated = false;
          customRole = 'Bloo is now Flying Away. The user can bring back Bloo by using the keyword.';
        }
    
        const reply = await chatGPT(conversationLog, customRole);
        const randomNumber = Math.random();
        let replyContent = reply;
        let replyFile = null;
    
        if (randomNumber < 0.1) { // 10% chance to send a GIF without text
          const gifQuery = await generateGifQuery(reply);
          if (gifQuery !== '') {
            const gifUrl = await gifHandler.getRelatedGif(gifQuery);
            if (gifUrl) {
              replyContent = null;
              replyFile = gifUrl;
            }
          }
        } else if (randomNumber >= 0.9) { // 20% chance to send a text message with a GIF
          const gifQuery = await generateGifQuery(reply);
          if (gifQuery !== '') {
            const gifUrl = await gifHandler.getRelatedGif(gifQuery);
            if (gifUrl) {
              replyFile = gifUrl;
            }
          }
        }
    
        // 70% chance to send a text message without a GIF (already handled by initializing replyContent)
        message.reply({ content: replyContent, files: replyFile ? [replyFile] : [] });
      }
    }
  } catch (error) { // This line should be here
    console.log(`ERR: ${error}`);
  }
  
});

client.on('voiceStateUpdate', (oldState, newState) => {
  voiceStateUpdate(oldState, newState);
});

client.on('messageCreate', message => {
  if (message.content.startsWith('!whosplaying')) {
    const args = message.content.slice('!whosplaying'.length).trim().split(/ +/g);
    crewmates.execute(message, args, client);
  }
});

client.login(process.env.TOKEN);