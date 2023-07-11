const { Client } = require('threads-api');
const Discord = require('discord.js');

// Initialize the Threads API client
const threadsClient = new Client();

// Map of Thread account names to Discord channel IDs
const channelMap = {
  'iamcharcharr': '1111704492904296460', // replace with the actual channel ID
  // add more mappings as needed
};

// Function to fetch and send posts
async function fetchAndSendPosts() {
  // Loop over each entry in the channel map
  for (const [accountName, channelId] of Object.entries(channelMap)) {
    // Fetch the latest post from the Thread account
    const posts = await threadsClient.getPosts(accountName);

    // Check if there are any posts
    if (posts.length > 0) {
      // Get the latest post
      const post = posts[0];

      // Get the Discord channel
      const channel = client.channels.cache.get(channelId);

      // Create a new Discord message embed
      const embed = new Discord.EmbedBuilder()
        .setTitle(post.title)
        .setDescription(post.description)
        .setURL(post.url)
        .setTimestamp(post.date);

      // Send the embed to the channel
      channel.send(embed);
    }
  }
}

// Export the function
module.exports = fetchAndSendPosts;
