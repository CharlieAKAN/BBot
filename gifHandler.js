const axios = require('axios');

const apiKey = process.env.TENOR_API_KEY;
console.log('Tenor API Key:', apiKey);
const apiUrl = `https://tenor.googleapis.com/v2/search?key=${apiKey}`;

async function getRelatedGif(userMessage) {
    try {
      const tenorResponse = await axios.get(`${apiUrl}&q=${encodeURIComponent(userMessage)}&limit=1`);
  
      console.log('Tenor response:', JSON.stringify(tenorResponse.data, null, 2));
  
      if (!tenorResponse.data.results || tenorResponse.data.results.length === 0) {
        console.log('No results found for the given query');
        return null;
      }
  
      const gifUrl = tenorResponse.data.results[0].media_formats.gif.url;
      return gifUrl;
    } catch (error) {
      console.log('Error getting related gif:', error);
      return null;
    }
  }

module.exports = {
  getRelatedGif,
};

