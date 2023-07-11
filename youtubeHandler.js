const { google } = require('googleapis');
const { DateTime } = require('luxon');
const fs = require('fs');
const channelId = 'UCF--xzWaBn_PbjgCwS0wNSQ'; // Replace with the YouTube channel ID

const apiKey = process.env.YOUTUBE_API_KEY;
const youtube = google.youtube({
  version: 'v3',
  auth: apiKey
});

let liveChecked = new Date(0); // Initialize with the beginning of the UNIX epoch (January 1, 1970)

function getLastPostedVideoId() {
  try {
    return fs.readFileSync('lastPostedVideoId.txt', 'utf8');
  } catch (error) {
    console.error(`Error reading lastPostedVideoId.txt: ${error}`);
    return null;
  }
}

function setLastPostedVideoId(videoId) {
  try {
    fs.writeFileSync('lastPostedVideoId.txt', videoId, 'utf8');
  } catch (error) {
    console.error(`Error writing to lastPostedVideoId.txt: ${error}`);
  }
}
async function getLiveStream(client) {
  const currentTime = DateTime.local().setZone('America/New_York');
  const currentDay = currentTime.weekday;
  const currentHour = currentTime.hour;
  const currentMinutes = currentTime.minute;

  if (
    (currentDay === 2 || currentDay === 4) && // Sunday is 7, Monday is 1, etc.
    (currentHour > 14 || (currentHour === 14 && currentMinutes >= 0)) &&
    (currentHour < 20 || (currentHour === 20 && currentMinutes <= 30))
  ) {
    console.log(`API call: getLiveStream at ${currentTime.toISO()}`);

    try {
      const response = await youtube.search.list({
        channelId,
        part: 'snippet',
        type: 'video',
        eventType: 'live',
        maxResults: 1
      });

      const video = response.data.items[0];

      if (video) {
        const videoId = video.id.videoId;
        const lastPostedVideoId = getLastPostedVideoId();

        if (videoId !== lastPostedVideoId) {
          const publishedAt = new Date(video.snippet.publishedAt);

          if (publishedAt > liveChecked) {
            liveChecked = currentTime;
            const videoTitle = video.snippet.title;
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            console.log(`videoTitle: ${videoTitle}`);
            console.log(`videoUrl: ${videoUrl}`);

            const liveChannel = client.channels.cache.get(process.env.LIVE_CHANNEL_ID);
            console.log(`liveChannel: ${liveChannel}`);
            liveChannel.send(`🚨🚨🚨 Hey @everyone, **Storytellers of The Apocalypse** is LIVE on YouTube! Follow this link to say Hi in chat 🚨🚨🚨\n${videoUrl}`);

            // Save the current video ID to the file
            setLastPostedVideoId(videoId);
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching live stream: ${error}`);
    }
  } else {
    console.log('getLiveStream is not called due to the time window');
  }
}

async function youtubeHandler(client) {
  await getLiveStream(client);
}

module.exports = youtubeHandler;
