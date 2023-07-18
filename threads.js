const { ThreadsAPI } = require('threads-api');

// Create an instance of the ThreadsAPI class
const threadsAPI = new ThreadsAPI();

// Store the ID of the last thread that was posted for each Thread account
let lastThreadIds = {};

// Function to check for new threads and post them to a Discord channel
async function checkForNewThreads(threadUsername, channel) {
  try {
    // Get the user ID from the username
    const userId = await threadsAPI.getUserIDfromUsername(threadUsername);

    // Get the latest threads from the Thread account
    const threads = await threadsAPI.getUserProfileThreads(userId);

    // If there are any threads and the latest one is not the same as the last one that was posted
    if (threads.length > 0 && threads[0].id !== lastThreadIds[threadUsername]) {
      // Update the last thread ID for the Thread account
      lastThreadIds[threadUsername] = threads[0].id;

      // Send a message to the channel with the new thread
      channel.send(`New thread posted: ${threads[0].title}\n${threads[0].url}`);
    }
  } catch (error) {
    console.error(`Error getting threads: ${error}`);
  }
}

// Export a function that takes bot as a parameter and starts checking for new threads
module.exports = function(bot) {
  bot.on('ready', () => {
    const threadAccounts = ['iamcharcharr', 'thread-account-2', /* ... */];
    const channelIds = ['1095471998831960216', 'discord-channel-id-2', /* ... */];

    threadAccounts.forEach((threadAccount, index) => {
      const channel = bot.channels.cache.get(channelIds[index]);
      setInterval(() => checkForNewThreads(threadAccount, channel), 30 * 1000);
    });
  });
};
