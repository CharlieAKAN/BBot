const { EmbedBuilder } = require('discord.js');

let usersInChannel = new Set();
let sentMessage = null;
let timeoutId = null;

module.exports = async (oldState, newState) => {
  const allowedRoles = ['STOA Streamers', 'STOA Manager'];
  const voiceChannelName = 'Streamer VC';
  const roleName = 'Join Streamers';
  const channelId = process.env.JOIN_CHANNEL_ID;

  const role = newState.guild.roles.cache.find(role => role.name === roleName);
  const member = newState.member;

  if (newState.channel?.name === voiceChannelName && member.roles.cache.some(memberRole => allowedRoles.includes(memberRole.name))) {
    usersInChannel.add(member.id);

    if (usersInChannel.size === 1 && timeoutId === null) {
      timeoutId = setTimeout(async () => {
        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('Join Streamer VC')
          .setDescription('Hi Gaming Friends\n\nAs we are growing more and more, we want to make sure we can play with as many people as possible but at the same time we don’t want Streamer VC to get over run.  So we are putting some new moderations in place. React below with 🟢 so you can join Streamer VC.');

        sentMessage = await newState.guild.channels.cache.get(channelId).send({ embeds: [embed] });
        await sentMessage.react('🟢');

        const filter = (reaction, user) => ['🟢'].includes(reaction.emoji.name);
        const collector = sentMessage.createReactionCollector({ filter });

        collector.on('collect', async (reaction, user) => {
          if (user.bot) return;

          const member = reaction.message.guild.members.cache.get(user.id);
          await member.roles.add(role).catch(console.error);

          const notificationChannel = newState.guild.channels.cache.get('539653049975570433'); 
          if (notificationChannel) {
            try {
              await notificationChannel.send(`${user}, your 'Join Streamers' role has been assigned, and you can join the 'Streamer VC' when you're ready.`);
            } catch (error) {
              console.error(`Could not send message to channel.\n`, error);
            }
          }
        });

        timeoutId = null;
      }, 1800000);
    }
  }

  if (oldState.channel?.name === voiceChannelName && member.roles.cache.some(memberRole => allowedRoles.includes(memberRole.name))) {
    usersInChannel.delete(member.id);

    if (usersInChannel.size === 0) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (sentMessage) {
        sentMessage.delete().catch(console.error);
        sentMessage = null;
      }
    }
  }
};