const Discord = require('discord.js');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'crewmates',
  description: 'Recruit crewmates for games',
  async execute(message, args, client) {
    const roleName = 'Join Streamers';
    const channelId = process.env.JOIN_CHANNEL_ID;
    const role = message.guild.roles.cache.find(role => role.name === roleName);

    // Fetch all members and check for pre-added members to the crew
    await message.guild.members.fetch();

    const gameCountIndex = args.findIndex(arg => /<@!?(\d+)>/.test(arg));
    console.log("gameCountIndex: ", gameCountIndex); // Debug line
    
    const gameName = gameCountIndex >= 0
    ? args.slice(1, gameCountIndex).join(' ')
    : args.slice(1).join(' ');
      
    console.log("gameName: ", gameName); // Debug line
    
    let addedCrewMembers = args.join(' ').match(/<@!?(\d+)>/g) || [];
    addedCrewMembers = addedCrewMembers.map(memberTag => {
      const id = memberTag.replace(/[<@!>]/g, '');
      return message.guild.members.cache.get(id);
    });

    let crewCount = 1 + addedCrewMembers.length;  
    let crewMembers = [message.author.id].concat(addedCrewMembers.map(member => member.id));
    let recruitmentOpen = true;
    let messagesToDelete = [];

    // Assign role to pre-added crew members
    for (const member of addedCrewMembers) {
      try {
        await member.roles.add(role);
      } catch (err) {
        console.error(`Failed to add role to ${member.user.tag}: ${err.message || err}`);
      }
    }

    messagesToDelete.push(message);

    // Remove role from other members
    for (const [, member] of message.guild.members.cache) {
      if (member.roles.cache.some(memberRole => memberRole.name === roleName) && !addedCrewMembers.includes(member)) {
        try {
          await member.roles.remove(role);
        } catch (err) {
          console.error(`Failed to remove role from ${member.user.tag}: ${err.message || err}`);
        }
      }
    }

    if (!message.member.roles.cache.some(role => role.name === "STOA Streamers" || role.name === "STOA Manager")) return;

    const filter = (reaction, user) => ['🎮', '❌'].includes(reaction.emoji.name);

    const MAX_CREW_SIZE = crewCount + parseInt(args[0]);  // Total crew size includes the command user, mentioned users, and the number of additional players required
    if(isNaN(MAX_CREW_SIZE)) {
      message.reply('You need to specify a valid player count.');
      return;
    }

    let gameNameLower = gameName.toLowerCase(); // Convert to lowercase

    const gameAliases = {
      'destiny 2': 'destiny',
      'sot': 'sea of thieves',
      'cod': 'call of duty',
      // Add more aliases here...
    };

    // Image mapping
    const gameImages = {
      'sea of thieves': 'https://media.discordapp.net/attachments/93073155496636416/1094156601746800650/Sea_of_Thieves_4_8_2023_3_06_36_AM.png?width=1333&height=750',
      'destiny': 'https://cdn.discordapp.com/attachments/808508638918475808/1111460724213039104/fireteam-witch-queen-hardmode_6kjk.1280.webp',
      'call of duty': 'https://cdn.discordapp.com/attachments/808508638918475808/1130986958387155065/maxresdefault.jpg',
      'fortnite': 'https://cdn.discordapp.com/attachments/808508638918475808/1131028388048556042/594a75b6948a3d4580b3586579d0c551_resize680383_.jpg',
      'exoprmal': 'https://cdn.discordapp.com/attachments/808508638918475808/1131031027897356440/EXOPRIMAL_VS-T.-Rex.webp',
    };
    
    if (gameNameLower in gameAliases) {
      gameNameLower = gameAliases[gameNameLower]; // Change alias to standard game name
    }
    
    let imageUrl = 'https://cdn.discordapp.com/attachments/808508638918475808/1111460959437979788/121081147_162294615544706_2155466804553880416_n_1.jpg';
    
    if (gameNameLower in gameImages) {
      imageUrl = gameImages[gameNameLower];
    }

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Gamer Recruitment')
      .setDescription(`Who wants to play ${gameName} tonight? We need ${MAX_CREW_SIZE} Gamers! React with 🎮 to join, react with ❌ to withdraw.`)
      .setImage(imageUrl);

    const everyoneMessage = await message.channel.send('@everyone');
    messagesToDelete.push(everyoneMessage);

    const gameRecruitmentMessage = await message.channel.send({ embeds: [embed] });
    await gameRecruitmentMessage.react('🎮');
    await gameRecruitmentMessage.react('❌');

    messagesToDelete.push(gameRecruitmentMessage);


    const recruitment = async (reaction, user) => {
      if (user.bot) return;
    
      const member = message.guild.members.cache.get(user.id);
    
      if (reaction.emoji.name === '❌') {
        if (crewMembers.includes(user.id)) {
          await member.roles.remove(role).catch(console.error);
          crewMembers = crewMembers.filter(id => id !== user.id);
          crewCount--;
    
          // Remove user's reaction from the pirate flag
          const gameControllerReaction = reaction.message.reactions.cache.get('🎮');
          await gameControllerReaction.users.remove(user).catch(console.error);
        
          const channel = client.channels.cache.get(channelId);
          const withdrawnMessage = await channel.send(`@everyone, <@${member.id}> has withdrawn from the crew. There is now a spot open!`).catch(console.error);
          messagesToDelete.push(withdrawnMessage);
    
          if (crewCount < MAX_CREW_SIZE) {
            recruitmentOpen = true; // NEW: open recruitment if there's a free slot
          }
        }
      }  else if (reaction.emoji.name === '🎮' && recruitmentOpen) {
            console.log('Pirate flag reaction added by:', user.tag); // NEW
        
        // First add user to crew and increment crewCount
        crewMembers.push(member.id);
        crewCount++;

        if (crewCount <= MAX_CREW_SIZE) {
          await member.roles.add(role).catch(err => {
            console.error('Failed to add role to user', user.tag, err.message);
          });
          
          console.log('Role added to user:', user.tag);

          const channel = client.channels.cache.get(channelId);
          const joinedMessage = await channel.send(`Hello, <@${member.id}>! You have been assigned the ${roleName} role. You can now join the Streamer VC! The Streamer will let you know when they plan to get on!`).catch(err => {
            console.error('Failed to send join message', err.message);
          });
          messagesToDelete.push(joinedMessage);
    
          console.log('Crew count:', crewCount); 
        } else {
          console.log('Crew is already full. User could not join:', user.tag);
        }
    
        if (crewCount >= MAX_CREW_SIZE) {          
          recruitmentOpen = false;
          let crewMentions = crewMembers.map(id => `<@${id}>`).join('\n');
          const fullCrewEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Full Game Tonight!')
            .setDescription('The Gamers for tonight are:')
            .setImage('https://media.discordapp.net/attachments/93073155496636416/1094156601746800650/Sea_of_Thieves_4_8_2023_3_06_36_AM.png?width=1333&height=750')
            .addFields({ name: 'Gamers', value: crewMentions });
            
          const fullGameMessage = await message.channel.send({ embeds: [fullCrewEmbed] }).catch(console.error);
          messagesToDelete.push(fullGameMessage);
        }
      }
    }
    
    const collector = gameRecruitmentMessage.createReactionCollector({ filter });
    collector.on('collect', recruitment);

    // Delete all messages after 12 hours
    setTimeout(() => {
      messagesToDelete.forEach(msg => {
        msg.delete().catch(console.error);
      });
    }, 43200000);  // 12 hours in milliseconds
  },
};


