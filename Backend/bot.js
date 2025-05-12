require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const WebSocket = require('ws');
const http = require('http');

// Discord bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

const token = process.env.TOKEN;

// WebSocket + HTTP server setup
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map(); // Map ws => { guildId, channelId }

// Broadcast a message to all clients watching a specific channel
function broadcastToChannel(guildId, channelId, message) {
  const payload = JSON.stringify(message);
  for (const [ws, info] of clients.entries()) {
    if (
      info.guildId === guildId &&
      info.channelId === channelId &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(payload);
    }
  }
}

// Discord bot event handlers
client.on('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  broadcastToChannel(message.guildId, message.channelId, {
    id: message.id,
    author: {
      username: message.author.username,
      id: message.author.id,
      avatar: message.author.displayAvatarURL({ size: 64 })
    },
    content: message.content,
    timestamp: message.createdAt
  });
});
client.on('messageUpdate', (oldMessage, newMessage) => {
  if (!newMessage.guildId || !newMessage.channelId || newMessage.author?.bot) return;

  // Send update to clients
  broadcastToChannel(newMessage.guildId, newMessage.channelId, {
    type: 'edit',
    id: newMessage.id,
    content: newMessage.content
  });
});
client.on('messageDelete', (message) => {
  if (!message.guildId || !message.channelId) return;

  broadcastToChannel(message.guildId, message.channelId, {
    type: 'delete',
    id: message.id
  });
});

// WebSocket handling
wss.on('connection', async (ws) => {
  console.log('🔌 WebSocket client connected');

  const guilds = client.guilds.cache.map(guild => ({
    id: guild.id,
    name: guild.name
  }));
  ws.send(JSON.stringify({ type: 'guildList', guilds }));

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'requestGuildList') {
        const guilds = client.guilds.cache.map(guild => ({
          id: guild.id,
          name: guild.name
        }));
        ws.send(JSON.stringify({ type: 'guildList', guilds }));
      }
      if (msg.type === 'selectGuild') {
        const guild = client.guilds.cache.get(msg.guildId);
        if (!guild) return;

        try {
          const fetchedChannels = await guild.channels.fetch();
          const channels = Array.from(fetchedChannels.values())
            .filter(c => c.isTextBased() && c.viewable)
            .map(c => ({ id: c.id, name: c.name }));
        
          ws.send(JSON.stringify({ type: 'channelList', channels }));
        } catch (err) {
          console.error('❌ Error fetching channels for guild:', err);
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to fetch channels' }));
        }
        
      }

      if (msg.type === 'selectChannel') {
        clients.set(ws, { guildId: msg.guildId, channelId: msg.channelId });
        ws.send(JSON.stringify({ type: 'joined', guildId: msg.guildId, channelId: msg.channelId }));
      }

      if (msg.type === 'chat') {
        const { guildId, channelId } = clients.get(ws) || {};
        if (!guildId || !channelId) return;
      
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
          const sent = await channel.send({
            content: msg.content,
            allowedMentions: {
              parse: ['users']
            }
          });
          
      
          // Echo the message back to all clients in this channel (including sender)
          const payload = {
            author: {
              username: sent.author.username,
              id: sent.author.id,
              avatar: sent.author.displayAvatarURL({ size: 64 })
            },
            content: sent.content,
            timestamp: sent.createdAt
          };
      
          broadcastToChannel(guildId, channelId, payload);
        }
      }
      
      if (msg.type === 'getMessages') {
        const channel = await client.channels.fetch(msg.channelId);
        if (channel && channel.isTextBased()) {
          const messages = await channel.messages.fetch({ limit: 20 });
          messages.reverse().forEach(message => {
            ws.send(JSON.stringify({
              id: message.id,
              author: {
                username: message.author.username,
                id: message.author.id,
                avatar: message.author.displayAvatarURL({ size: 64 })
              },
              content: message.content,
              timestamp: message.createdAt
            }));
          });
        }
      }
    } catch (err) {
      console.error('❌ Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('🔌 WebSocket client disconnected');
  });
});

// HTTP POST /send route
app.post('/send', async (req, res) => {
  const { channelId, message } = req.body;

  if (!channelId || !message) {
    return res.status(400).json({ error: 'Missing channelId or message' });
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ error: 'Invalid channel' });
    }

    const sent = await channel.send(message);

    const payload = {
      id: sent.id,
      content: sent.content,
      timestamp: sent.createdAt.toISOString(),
      author: {
        id: sent.author.id,
        username: sent.author.username,
        avatar: sent.author.displayAvatarURL({ size: 64 })
      }
    };

    broadcastToChannel(channel.guildId, channelId, payload);

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Send error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});


// Start server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});

// Start bot
client.login(token);
