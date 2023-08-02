const fs = require('fs');
const path = require('path');

function readShortTermMemory() {
    // Define the path to the memory folder and the shortTermMemory.txt file
    const memoryFolderPath = path.join(__dirname, 'memory');
    const shortTermMemoryPath = path.join(memoryFolderPath, 'shortTermMemory.txt');
  
    // Read the contents of the shortTermMemory.txt file
    const shortTermMemoryContent = fs.readFileSync(shortTermMemoryPath, 'utf-8');
  
    // Split the content into lines and map each line to an object with a role and content property
    const shortTermMemoryLines = shortTermMemoryContent.split('\n').filter(line => line);
    return shortTermMemoryLines.map(line => {
      const [username, content] = line.split(': ');
      return { role: username === 'Bloo' ? 'assistant' : 'user', content };
    });
  }

module.exports = {
  readShortTermMemory,
};
