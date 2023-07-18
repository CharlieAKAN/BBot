const { ThreadsAPI } = require('threads-api');

// Create an instance of the ThreadsAPI class
const threadsAPI = new ThreadsAPI();

// Store the ID of the last thread that was posted for each Thread account
let lastThreadIds = {};

// Function to check for new threads and post them to a Discord channel
async function checkForNewThreads(threadUsername, channel) {
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

      // Send a message to the channel with the new thread
      channel.send(`New thread posted: ${threads[0].title}\n${threads[0].url}`);
    } else {
      console.log(`No new threads found for ${threadUsername}`);
    }
  } catch (error) {
    console.error(`Error getting threads: ${error}`);
  }
}

module.exports = function(bot) {
  bot.on('ready', () => {
    console.log('Bot is ready in threads.js');
    const threadAccounts = ['iamcharcharr', 'thread-account-2', /* ... */];
    const channelIds = ['1095471998831960216', 'discord-channel-id-2', /* ... */];

    threadAccounts.forEach((threadAccount, index) => {
      const channel = bot.channels.cache.get(channelIds[index]);
      setInterval(() => {
        console.log(`Checking for new threads from ${threadAccount} at ${new Date().toLocaleTimeString()}`);
        checkForNewThreads(threadAccount, channel);
      }, 30 * 1000);
    });
  });
};
