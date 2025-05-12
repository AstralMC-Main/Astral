require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// File paths
const ECO_PATH = './eco.json';
const ADMIN_PATH = './admin.json';
const GLOBAL_ADMIN_PATH = './global_admin.json';
const SETTINGS_PATH = './user_settings.json';
// Ensure JSON files exist
for (const file of [ECO_PATH, ADMIN_PATH, GLOBAL_ADMIN_PATH, SETTINGS_PATH]) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '{}');
  }
}
// Utility functions
function loadJSON(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}
function saveJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function getBalance(userId) {
  const eco = loadJSON(ECO_PATH);
  return eco[userId] ?? 0;
}
function setBalance(userId, amount) {
  const eco = loadJSON(ECO_PATH);
  eco[userId] = Math.max(0, amount);
  saveJSON(ECO_PATH, eco);
}
function addBalance(userId, amount) {
  const eco = loadJSON(ECO_PATH);
  eco[userId] = (eco[userId] ?? 0) + amount;
  saveJSON(ECO_PATH, eco);
}

function isAdmin(userId) {
  return loadJSON(ADMIN_PATH)[userId] || isGlobalAdmin(userId);
}
function isGlobalAdmin(userId) {
  return loadJSON(GLOBAL_ADMIN_PATH)[userId];
}
function addAdmin(userId) {
  const admins = loadJSON(ADMIN_PATH);
  admins[userId] = true;
  saveJSON(ADMIN_PATH, admins);
}
function removeAdmin(userId) {
  const admins = loadJSON(ADMIN_PATH);
  delete admins[userId];
  saveJSON(ADMIN_PATH, admins);
}
function listAdmins() {
  return Object.keys(loadJSON(ADMIN_PATH));
}

// Settings
function getUserRange(userId) {
  return loadJSON(SETTINGS_PATH)[userId]?.range ?? 3600;
}
function setUserRange(userId, seconds) {
  const settings = loadJSON(SETTINGS_PATH);
  if (!settings[userId]) settings[userId] = {};
  settings[userId].range = seconds;
  saveJSON(SETTINGS_PATH, settings);
}
function parseDurationToSeconds(str) {
  const match = str.match(/^(\d+)([mh])$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  return match[2].toLowerCase() === 'h' ? num * 3600 : num * 60;
}

// Stock data
let stockData = [];

// Simulate new stock price
function generateStockPrice() {
  const last = stockData.at(-1)?.price ?? 100;
  const change = (Math.random() - 0.5) * 2;
  return Math.max(1, last + change);
}

// Render stock graph
function renderStockGraph(userId) {
  const range = getUserRange(userId);
  const cutoff = Date.now() - range * 1000;
  const data = stockData.filter(p => p.timestamp >= cutoff);
  const width = 50;
  const height = 20;

  if (data.length === 0) return 'No data.';

  const prices = data.map(p => p.price);
  const minPrice = Math.floor(Math.min(...prices) / 5) * 5;
  const maxPrice = Math.ceil(Math.max(...prices) / 5) * 5;
  const priceRange = maxPrice - minPrice || 1;

  const graph = Array.from({ length: height }, () => Array(width).fill('░'));

  const points = [];
  for (let x = 0; x < width; x++) {
    const i = Math.floor(x * data.length / width);
    const price = data[i]?.price ?? 0;
    const y = height - 1 - Math.floor((price - minPrice) / priceRange * (height - 1));
    points.push({ x, y });
  }

  for (let i = 0; i < points.length - 1; i++) {
    const { x, y } = points[i];
    const nextY = points[i + 1].y;
  
    const [minY, maxY] = y < nextY ? [y, nextY] : [nextY, y];
    for (let yi = minY; yi <= maxY; yi++) {
      if (graph[yi]) graph[yi][x] = '█';
    }
  
    // Optional: add light shadow below
    if (graph[maxY + 1]) graph[maxY + 1][x] = '▒';
    if (graph[maxY + 2]) graph[maxY + 2][x] = '▒';
  }
  

  for (let y = 0; y < height; y++) {
    if (y % 4 === 0) {
      const label = `${maxPrice - Math.floor(y / (height - 1) * priceRange)}`.padStart(4);
      graph[y].unshift(label + ' ┤');
    } else {
      graph[y].unshift('     │');
    }
  }

  const bottom = '     └' + '─'.repeat(width);
  return '```' + [...graph.map(r => r.join('')), bottom].join('\n') + '```';
}

// Slash commands
client.commands.set('balance', {
  data: new SlashCommandBuilder().setName('balance').setDescription('Check your current balance.'),
  async execute(i) {
    await i.reply(`💰 You have **${getBalance(i.user.id)} coins**.`);
  },
});

client.commands.set('reseteco', {
  data: new SlashCommandBuilder().setName('reseteco').setDescription('Reset a user’s balance.').addUserOption(opt => opt.setName('user').setDescription('User to reset balance for')),
  async execute(i) {
    if (!isAdmin(i.user.id)) return i.reply({ content: 'Admins only.', ephemeral: true });
    const user = i.options.getUser('user') || i.user;
    setBalance(user.id, 0);
    await i.reply(`Reset balance of ${user.username}.`);
  }
});

client.commands.set('seteco', {
  data: new SlashCommandBuilder().setName('seteco').setDescription('Set user balance.').addIntegerOption(opt => opt.setName('amount').setDescription('Amount to set').setRequired(true)).addUserOption(opt => opt.setName('user').setDescription('User to set balance for')),
  async execute(i) {
    if (!isAdmin(i.user.id)) return i.reply({ content: 'Admins only.', ephemeral: true });
    const user = i.options.getUser('user') || i.user;
    const amount = i.options.getInteger('amount');
    setBalance(user.id, amount);
    await i.reply(`Set ${user.username}'s balance to ${amount}.`);
  }
});

client.commands.set('range', {
  data: new SlashCommandBuilder().setName('range').setDescription('Set how much time of stock graph to show.').addStringOption(opt => opt.setName('time').setDescription('e.g., 30m, 2h').setRequired(true)),
  async execute(i) {
    const input = i.options.getString('time');
    const seconds = parseDurationToSeconds(input);
    if (!seconds || seconds <= 0 || seconds > 43200) {
      return i.reply({ content: 'Invalid range. Use `30m`, `2h`, max `12h`.', ephemeral: true });
    }
    setUserRange(i.user.id, seconds);
    await i.reply({ content: `Set your graph range to ${input}.`, ephemeral: true });
  }
});

client.commands.set('stock', {
  data: new SlashCommandBuilder().setName('stock').setDescription('Show live-updating stock graph.'),
  async execute(i) {
    await i.deferReply({ ephemeral: true }); // 🔒 make initial reply hidden
    const userId = i.user.id;

    const update = async () => {
      const graph = renderStockGraph(userId);
      try {
        await i.editReply({ content: graph }); // no need for ephemeral here, it inherits
      } catch {}
    };

    await update();
    const interval = setInterval(update, 5000);

    setTimeout(() => clearInterval(interval), getUserRange(userId) * 1000);
    // Add Y-axis labels
    for (let y = 0; y < height; y++) {
      if (y % 4 === 0) {
        const label = `${maxPrice - Math.floor(y / (height - 1) * priceRange)}`.padStart(4);
        graph[y].unshift(label + ' ┤');
      } else {
        graph[y].unshift('     │');
      }
    }

    // Create time bar
    const timeBar = '     └' + '─'.repeat(width);

    // Time labels
    const start = data[0].timestamp;
    const end = data.at(-1).timestamp;
    const labelCount = 4;
    const labelRow = Array(width).fill(' ');
    for (let i = 0; i < labelCount; i++) {
      const t = new Date(start + (i / (labelCount - 1)) * (end - start));
      const timeStr = t.toTimeString().slice(0, 5);
      const x = Math.floor(i * (width - 1) / (labelCount - 1)) - Math.floor(timeStr.length / 2);
      for (let j = 0; j < timeStr.length && x + j < width; j++) {
        if (x + j >= 0) labelRow[x + j] = timeStr[j];
      }
    }
    const timeLabels = '     ' + labelRow.join('');

    return '```' + [...graph.map(r => r.join('')), timeBar, timeLabels].join('\n') + '```';

  }
});


client.commands.set('help', {
  data: new SlashCommandBuilder().setName('help').setDescription('Show command list.'),
  async execute(i) {
    await i.reply({
      content:
        `🛠️ Commands:\n` +
        `• /balance /stock /range /help\n` +
        `• /reseteco /seteco (admin)\n`,
      ephemeral: true,
    });
  },
});

// Event handlers
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (command) {
    try {
      await command.execute(interaction);
    } catch (e) {
      console.error(e);
      await interaction.reply({ content: 'Error running command.', ephemeral: true });
    }
  }
});

// Simulate stock updates
setInterval(() => {
  stockData.push({ timestamp: Date.now(), price: generateStockPrice() });
  if (stockData.length > 10000) stockData.shift(); // prevent unbounded growth
}, 5000);

// Login
client.login(process.env.TOKEN);
const { REST, Routes } = require('discord.js');

(async () => {
  const commands = client.commands.map(cmd => cmd.data.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    console.log('📡 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
