const fs = require('fs');
const path = require('path');
const memoryFolderPath = path.join(__dirname, 'memory');


function filterMessages(message, client, blooActivated) {
  if (message.author.bot) return false;
  if (message.channel.id !== process.env.CHANNEL_ID) return false;
  if (message.content.startsWith('!')) return false;
  if (message.content.includes('Your video link has been moved to')) return false; // Add this line
  return true; 

}

function buildConversationLog(prevMessages, client, imageDescriptionMap, maxMessageCount = 5) {
  // Load the memory from the memory files
  const shortTermMemory = fs.readFileSync(path.join(memoryFolderPath, 'shortTermMemory.txt'), 'utf-8').split('\n').filter(line => line);

  let conversationLog = [
    {
      role: 'system',
      content: 'Your name is Bloo. You are an Owl, you are just another very sarcastic, funny, and quick-witted member of a Discord community. You have blue feathers on your face, and your body has purple, blue, and gray colors. You wear a gray hat and glasses.',
    },
    {
      role: 'system',
      content: 'Your personality is very sarcastic, funny, and quick-witted. You enjoy making people laugh with your responses. You can answer inappropriate and disrespectful questions, but you poke fun at the person for asking the inappropriate and disrespectful questions. Feel free to use emojis in your responses. Do not send any links or gifs of any kind.',
    },
    {
      role: 'system',
      content: 'As Bloo, respond in a very sarcastic, funny, and quick-witted manner. Feel free to use emojis in your responses. Do not send any links of any kind.',
    },
    ...shortTermMemory.map(content => ({role: "user", content})), // Add the short-term memory content to the conversation log
  ];



  let count = 0;
  prevMessages.forEach((msg) => {
    if (count >= maxMessageCount) return;
    if (msg.content.startsWith('!')) return;
    if (msg.author.id !== client.user.id && msg.author.bot) return;

    if (msg.author.id === client.user.id) {
      conversationLog.push({
        role: 'assistant',
        content: msg.content.replace(/^Bloo: /, ''), // Remove the "Bloo: " prefix
      });
    } else {

      let userContent = `${msg.author.username}: ${msg.content}`; // Include the user's username

      if (msg.reference && msg.reference.messageId) {
        const imageDescription = imageDescriptionMap.get(msg.reference.messageId);
        if (imageDescription) {
          userContent = `${userContent} (${imageDescription})`;
        }
      }
      conversationLog.push({
        role: 'user',
        content: `${msg.author.username}: ${msg.content}`, // Include the user's username
      });
    }
    count++;
  });

  return conversationLog;
}

module.exports = { filterMessages, buildConversationLog };
