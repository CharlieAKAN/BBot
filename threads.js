const { ThreadsAPI } = require('threads-api');
const Discord = require('discord.js');
const tinyurl = require('tinyurl');

// Create an instance of the ThreadsAPI class
const threadsAPI = new ThreadsAPI();

// Store the ID of the last thread that was posted for each Thread account
let lastThreadIds = {};
let delayTimes = {};

// Function to check for new threads and post them to a Discord channel
async function checkForNewThreads(threadUsername, channel, checkAndReschedule) {
  try {
    console.log(`Checking for new threads from ${threadUsername}...`);

    // Get the user ID from the username
    const userId = await threadsAPI.getUserIDfromUsername(threadUsername);
    console.log(`User ID for ${threadUsername}: ${userId}`);

    // Get the latest threads from the Thread account
    const threads = await threadsAPI.getUserProfileThreads(userId);
    console.log(`Threads for ${threadUsername}:`, threads);

    // If there are any threads and the latest one is not the same as the last one that was posted
    if (threads.length > 0 && threads[0].id !== lastThreadIds[threadUsername]) {
      console.log(`New thread found for ${threadUsername}`);
    
      // Update the last thread ID for the Thread account
      lastThreadIds[threadUsername] = threads[0].id;
    
      // Get the original post from the thread
      const originalPost = threads[0].thread_items[0].post;
      const title = originalPost.caption ? originalPost.caption.text : ''; 
      const url = `https://www.threads.net/@${threadUsername}/post/${originalPost.code}/`;
      const shortUrl = await tinyurl.shorten(url); // Add this line here
      const profilePicUrl = originalPost.user.profile_pic_url;
      let imageUrl;
      if (originalPost.image_versions2 && originalPost.image_versions2.candidates && originalPost.image_versions2.candidates[0]) {
        imageUrl = originalPost.image_versions2.candidates[0].url;
      }

      // Create an embed
      const embed = new Discord.EmbedBuilder()
        .setColor('#C13584')
        .setAuthor({ name: threadUsername, iconURL: profilePicUrl })
        .setURL(shortUrl) // Use shortUrl here instead of url
        .setDescription(`[${title}](${shortUrl})`) // Use shortUrl here instead of url
        .setFooter({ text: 'Posted On Threads', iconURL: 'https://static.xx.fbcdn.net/rsrc.php/v3/yV/r/_8T3PbCSTRI.png' }); // Update this line
                  
      if (imageUrl) {
        embed.setImage(imageUrl);
      }
      
      if (originalPost.text_post_app_info && originalPost.text_post_app_info.link_preview_attachment) {
        const linkPreview = originalPost.text_post_app_info.link_preview_attachment;
        embed.addFields(
          { name: 'Headline', value: linkPreview.title }
        );
        if (linkPreview.image_url) {
          embed.setImage(linkPreview.image_url);
        }
      }
      
      // Send the embed to the channel
      channel.send({ embeds: [embed] });
    } else {
      console.log(`No new threads found for ${threadUsername}`);
    }
  } catch (error) {
    console.error(`Error getting threads: ${error.message}`);
    console.error(error.stack);
    if (error.response && error.response.status === 429) {
      // If a rate limit error occurred, double the delay time for this thread account
      delayTimes[threadUsername] = (delayTimes[threadUsername] || 10 * 60 * 1000) * 3;
    }
    // Schedule the next check here, after the delay time has been increased
    setTimeout(checkAndReschedule, delayTimes[threadUsername] || 10 * 60 * 1000);
  }
}

module.exports = function(bot) {
  bot.on('ready', () => {
    console.log('Bot is ready in threads.js');
    const threadAccounts = ['groundnews', 'seaofthievesgame', 'destinythegame', 'playdiablo', 'charlieintel', 'pokemontcg', 'discussingfilm', 'marvel', 'falconbrickstudios',];
    const channelIds = ['1088969247419531386', '603334971066810381', '1118749148951355392', '1118749443030777907', '1121847826209570948', '828765365470363689', '1088662067566878841', '831224568903237642', '830960829980606485',];

    threadAccounts.forEach((threadAccount, index) => {
      const channel = bot.channels.cache.get(channelIds[index]);
      const checkAndReschedule = () => {
        checkForNewThreads(threadAccount, channel, checkAndReschedule);
      };
      // Start the checks for this account after a delay based on its index
      setTimeout(checkAndReschedule, index * 60 * 1000); // 1 minute delay per index
    });
  });
};

