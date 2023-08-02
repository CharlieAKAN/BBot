const { Configuration, OpenAIApi } = require('openai');

const configuration = new Configuration({
  apiKey: process.env.API_KEY,
});
const openai = new OpenAIApi(configuration);

async function chatGPT(input, customRole = null) {
  // Handle both string and array input types
  let conversationLog = [];

  if (typeof input === 'string') {
    conversationLog.push({ role: 'system', content: 'You are a helpful assistant.Do not send any links or gifs of any kind.' });
    conversationLog.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    conversationLog = input;
  } else {
    throw new Error('Invalid input format for chatGPT function. Expected string or array.');
  }
  
  
  try {
    // Calculate total tokens in the conversation log
    let totalTokens = 0;
    conversationLog.forEach((message) => {
      totalTokens += message.content.split(' ').length;
    });

    // Remove oldest messages until the token count is within an acceptable range
    const maxTokensAllowed = 3800; // Adjust this value as needed
    while (totalTokens > maxTokensAllowed) {
      conversationLog.shift();
      totalTokens = 0;
      conversationLog.forEach((message) => {
        totalTokens += message.content.split(' ').length;
      });
    }

    const result = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: conversationLog,
      temperature: 0.8,
      max_tokens: 100,
    });

    let message = result.data.choices[0].message.content;

    const maxMessageLength = 200; // Set the maximum length for the reply
    if (message.length > maxMessageLength) {
      const sentences = message.split('. ');
      let truncatedMessage = sentences[0];
    
      for (let i = 1; i < sentences.length; i++) {
        if ((truncatedMessage + '. ' + sentences[i]).length < maxMessageLength - 3) {
          truncatedMessage += '. ' + sentences[i];
        } else {
          break;
        }
      }
    
      message = truncatedMessage + '...';
    }

    if (customRole) {
      conversationLog.push({
        role: 'assistant',
        content: message,
      });
      conversationLog.push({
        role: 'system',
        content: 'Bloo, say your farewell message and fly away.', // Updated instruction
      });

      console.log('Farewell conversation log:', JSON.stringify(conversationLog, null, 2));

      const farewellResult = await openai.createChatCompletion({
        model: 'gpt-4',
        messages: conversationLog, // Fix this line
        temperature: 0.8,
        max_tokens: 100,
      });
    
      const farewellMessage = farewellResult.data.choices[0].message.content;
      message = `${message.trim()} ${farewellMessage.trim()}`;      
    }

    return message;
  } catch (error) {
    console.error(`OPENAI ERR: ${error}`);
    throw error;
  }
}

module.exports = {
  chatGPT,
  openai,
};