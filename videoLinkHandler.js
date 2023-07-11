const client = require('cheerio-httpcli');

const keywordMapping = [
  {
    keywords: ['sea of thieves', 'pirate', 'rare', 'barrel', 'treasure', 'ship', 'crew', 'island', 'sea shanties', 'kraken', 'skeleton', 'mermaid', 'gold', 'plunder', 'cannon', 'anchor', 'map', 'compass', 'helm', 'sail', 'mast', 'rigging', 'harpoon', 'rowboat', 'treasure chest', 'outpost', 'fort', 'bounty', 'reputation', 'pirate legend', 'skull fort', 'tall tale', 'voyage'],
    channelId: '1066815669477318656',
    roleId: '611641334729539594',
  },
  {
    keywords: ['Pokemon', 'Pokemon TCG', 'Pokemon Video Game', 'Pikachu', 'Charmander', 'Squirtle', 'Bulbasaur', 'trainers', 'gyms', 'battles', 'types', 'evolution', 'Pokedex', 'Legendary Pokemon', 'Mega Evolution', 'Dynamax', 'Max Raid Battles', 'Galar Region', 'Kanto Region', 'Johto Region', 'Hoenn Region', 'Sinnoh Region', 'Unova Region', 'Kalos Region', 'Alola Region', 'Galar Region', 'breeding', 'Pokeballs', 'TMs', 'HMs', 'Z-Moves', 'Abilities', 'IVs', 'EVs', 'Shiny Pokemon'],
    channelId: '1095095594697097396',
    roleId: '555888416001359902',
  },
];

const excludedChannels = ['474982828677791764', '728016039761281054'];


const moveVideoLink = async (message, channelId, roleId) => {
  try {
    const targetChannel = message.guild.channels.cache.get(channelId);
    console.log('Target channel:', targetChannel);
    if (!targetChannel) {
      console.log(`Target channel ${channelId} not found`);
      return;
    }
    if (roleId) {
      await targetChannel.send(`Hey <@&${roleId}>! <@${message.author.id}> just posted an awesome new video: ${message.content} check it out!`);
    } else {
      await targetChannel.send(`<@${message.author.id}> just posted a new TikTok video: ${message.content}.`);
    }
    await message.delete();
    await message.channel.send(`<@${message.author.id}> Your video link has been moved to ${targetChannel}.`);
  } catch (error) {
    console.error('Error moving video link:', error);
  }
};

const fetchUrlContent = async (url) => {
  try {
    const result = await client.fetch(url);
    const pageTitle = result.$('title').text();
    const metaDescription = result.$('meta[name="description"]').attr('content') || '';
    return `${pageTitle} ${metaDescription}`;
  } catch (error) {
    console.error('Error fetching URL content:', error);
    return '';
  }
};

const VIDEO_HOSTS_REGEX = /((www\.)?youtube(\.com)?|youtu\.be|www\.vimeo(\.com)?|www\.tiktok(\.com)?|www\.twitch(\.tv)?|www\.dailymotion(\.com)?|www\.medal(\.tv)?|medal\.tv)/i;

const extractHashtags = (text) => {
  const hashtagRegex = /#[\w]+/g;
  return text.match(hashtagRegex) || [];
};

const normalizeText = (text) => {
  return text.toLowerCase().replace(/\s+/g, '');
};

const checkKeywordsInContent = (content, mapping) => {
  const normalizedContent = normalizeText(content);
  for (const keyword of mapping.keywords) {
    const regex = new RegExp(`\\b${normalizeText(keyword)}\\b`, 'g');
    if (regex.test(normalizedContent)) {
      return true;
    }
  }
  return false;
};
const handleVideoLinks = async (message) => {
  if (message.author.bot) return false;
  console.log('Checking video links...');
  const content = message.content;
  const otherChannelId = '808508638918475808';

  const urlMatches = content.match(/https?:\/\/[^\s]+/gi);
  if (!urlMatches || urlMatches.length === 0) {
    return false;
  }

  if (excludedChannels.includes(message.channel.id)) {
    console.log('Channel is in the excluded channels list');
    return false;
  }

  const url = urlMatches[0];
  if (!VIDEO_HOSTS_REGEX.test(url)) {
    console.log('URL not matching video host regex:', url);
    return false;
  } else {
    console.log('URL matching video host regex:', url);
  }

  // Fetch the content of the URL
  const fetchedContent = await fetchUrlContent(url);

  // Extract hashtags from the fetched content
  const hashtags = extractHashtags(fetchedContent);

  // Check for keywords in the extracted content and hashtags
  let foundMatchingChannel = false;
  for (const mapping of keywordMapping) {
    if (checkKeywordsInContent(content, mapping) || checkKeywordsInContent(fetchedContent, mapping) || hashtags.some(hashtag => checkKeywordsInContent(hashtag, mapping))) {
      // Check if the message is already in the correct channel
      if (message.channel.id === mapping.channelId) {
        console.log(`Message already in the correct channel (${mapping.channelId})`);
        return false;
      }

      await moveVideoLink(message, mapping.channelId, mapping.roleId);
      foundMatchingChannel = true;
      return true;
    }
  }
  
    if (!foundMatchingChannel) {
      const otherChannel = message.guild.channels.cache.get(otherChannelId);
      if (otherChannel) {
        await otherChannel.send(`<@${message.author.id}> Sorry, we couldn't determine the appropriate channel for your video link: "${message.content}". Please add more keywords to your message.`);
      } else {
        console.log('Other channel not found');
      }
    }
  
    if (!foundMatchingChannel) {
      if (content.includes('tiktok.com') || (message.embeds && message.embeds.some(embed => embed.provider.name === 'TikTok'))) {
        const targetChannel = message.guild.channels.cache.get('962483274905690162');
        if (targetChannel) {
          // If the message is already in the target channel, do nothing.
          if (message.channel.id === targetChannel.id) {
            return false;
          }
          await targetChannel.send(`<@${message.author.id}> just posted a new TikTok video: ${message.content}.`);
          await message.delete();
          await message.channel.send(`<@${message.author.id}> Your TikTok video has been moved to ${targetChannel}.`);
          return true;
        } else {
          console.log('Target TikTok channel not found');
        }
      }
    }
  
    return false;
  };
  
  module.exports = {
    handleVideoLinks,
  };