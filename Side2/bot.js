require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, Events, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

const BALANCES_FILE = './balances.json';
const INVENTORY_FILE = './inventory.json';
const LOOTBOXES_FILE = './lootboxes.json';
const ADMINS_FILE = './admins.json';
const SETTINGS_FILE = './settings.json';

const balances = loadOrInit(BALANCES_FILE);
const inventory = loadOrInit(INVENTORY_FILE);
const lootboxes = loadOrInit(LOOTBOXES_FILE);
const admins = loadOrInit(ADMINS_FILE, []);
const settings = loadOrInit(SETTINGS_FILE);

function loadOrInit(file, defaultValue = {}) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
  return JSON.parse(fs.readFileSync(file));
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isAdmin(userId) {
  return admins.includes(userId);
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const { commandName, options, user } = interaction;

    if (commandName === 'balance') {
      const target = options.getUser('user') || user;
      const bal = balances[target.id] || 0;
      await interaction.reply(`${target.username}'s balance: $${bal}`);
    }

    else if (commandName === 'seteco' && isAdmin(user.id)) {
      const target = options.getUser('user');
      const amount = options.getInteger('amount');
      balances[target.id] = amount;
      save(BALANCES_FILE, balances);
      await interaction.reply(`Set ${target.username}'s balance to $${amount}`);
    }

    else if (commandName === 'addeco' && isAdmin(user.id)) {
      const target = options.getUser('user');
      const amount = options.getInteger('amount');
      balances[target.id] = (balances[target.id] || 0) + amount;
      save(BALANCES_FILE, balances);
      await interaction.reply(`Added $${amount} to ${target.username}'s balance.`);
    }

    else if (commandName === 'reseteco' && isAdmin(user.id)) {
      for (const id in balances) delete balances[id];
      save(BALANCES_FILE, balances);
      await interaction.reply('All balances have been reset.');
    }

    else if (commandName === 'editmessage' && isAdmin(user.id)) {
      const newMsg = options.getString('message');
      settings.message = newMsg;
      save(SETTINGS_FILE, settings);
      await interaction.reply(`Bot message updated.`);
    }

    else if (commandName === 'lootbox') {
      const sub = options.getSubcommand();

      if (sub === 'create' && isAdmin(user.id)) {
        const name = options.getString('name');
        if (lootboxes[name]) return await interaction.reply({ content: 'Lootbox already exists.', ephemeral: true });
        lootboxes[name] = { items: [], drops: 1 };
        save(LOOTBOXES_FILE, lootboxes);
        await interaction.reply(`Lootbox \`${name}\` created.`);
      }

      else if (sub === 'delete' && isAdmin(user.id)) {
        const name = options.getString('name');
        if (!lootboxes[name]) return await interaction.reply({ content: 'Lootbox not found.', ephemeral: true });
        delete lootboxes[name];
        save(LOOTBOXES_FILE, lootboxes);
        await interaction.reply(`Lootbox \`${name}\` deleted.`);
      }

      else if (sub === 'list') {
        const embed = new EmbedBuilder().setTitle('Lootboxes');
        for (const name in lootboxes) {
          const box = lootboxes[name];
          const items = box.items.map(i => `${i.name} (${i.weight})`).join(', ') || 'None';
          embed.addFields({ name, value: `Items: ${items}\nDrops: ${box.drops}` });
        }
        await interaction.reply({ embeds: [embed] });
      }

      else if (sub === 'edit' && isAdmin(user.id)) {
        const name = options.getString('name');
        if (!lootboxes[name]) return await interaction.reply({ content: 'Lootbox not found.', ephemeral: true });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`edit_additem_${name}`).setLabel('Add Item').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`edit_setdrops_${name}`).setLabel('Set Drops').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ content: `Editing lootbox: \`${name}\``, components: [row] });
      }

      else if (sub === 'give' && isAdmin(user.id)) {
        const name = options.getString('name');
        const target = options.getUser('user');
        if (!lootboxes[name]) return await interaction.reply({ content: 'Lootbox not found.', ephemeral: true });
        const inv = inventory[target.id] = inventory[target.id] || [];
        inv.push(name);
        save(INVENTORY_FILE, inventory);
        await interaction.reply(`${target.username} received 1 \`${name}\` lootbox.`);
      }

      else if (sub === 'open') {
        const inv = inventory[user.id] = inventory[user.id] || [];
        const name = options.getString('name');
        if (!inv.includes(name)) return await interaction.reply({ content: 'You do not have that lootbox.', ephemeral: true });
        const box = lootboxes[name];
        if (!box) return await interaction.reply({ content: 'Lootbox not found.', ephemeral: true });

        inv.splice(inv.indexOf(name), 1);
        save(INVENTORY_FILE, inventory);

        const drops = [];
        for (let i = 0; i < box.drops; i++) {
          const total = box.items.reduce((sum, i) => sum + i.weight, 0);
          const r = Math.random() * total;
          let acc = 0;
          for (const item of box.items) {
            acc += item.weight;
            if (r < acc) {
              drops.push(item.name);
              break;
            }
          }
        }

        drops.forEach(item => inv.push(item));
        save(INVENTORY_FILE, inventory);
        await interaction.reply(`You opened \`${name}\` and got: ${drops.join(', ')}`);
      }
    }

    else if (commandName === 'inventory') {
      const target = options.getUser('user') || user;
      const inv = inventory[target.id] || [];
      const counts = {};
      inv.forEach(i => counts[i] = (counts[i] || 0) + 1);
      const lines = Object.entries(counts).map(([item, count]) => `${item}: ${count}`);
      await interaction.reply(lines.length ? lines.join('\n') : 'Inventory is empty.');
    }
  }

  if (interaction.isButton()) {
    const [action, type, name] = interaction.customId.split('_');
    if (action === 'edit' && type === 'additem') {
      const modal = new ModalBuilder().setCustomId(`modal_additem_${name}`).setTitle(`Add item to ${name}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('itemname').setLabel('Item Name').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('weight').setLabel('Weight').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
    }

    else if (action === 'edit' && type === 'setdrops') {
      const modal = new ModalBuilder().setCustomId(`modal_setdrops_${name}`).setTitle(`Set drops for ${name}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('drops').setLabel('Drops per open').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {
    const [_, type, name] = interaction.customId.split('_');

    if (type === 'additem') {
      const itemName = interaction.fields.getTextInputValue('itemname');
      const weight = parseInt(interaction.fields.getTextInputValue('weight'));
      if (!lootboxes[name]) return await interaction.reply({ content: 'Lootbox not found.', ephemeral: true });
      lootboxes[name].items.push({ name: itemName, weight });
      save(LOOTBOXES_FILE, lootboxes);
      await interaction.reply(`Added \`${itemName}\` with weight ${weight} to \`${name}\`.`);
    }

    else if (type === 'setdrops') {
      const drops = parseInt(interaction.fields.getTextInputValue('drops'));
      if (!lootboxes[name]) return await interaction.reply({ content: 'Lootbox not found.', ephemeral: true });
      lootboxes[name].drops = drops;
      save(LOOTBOXES_FILE, lootboxes);
      await interaction.reply(`Set drops for \`${name}\` to ${drops}.`);
    }
  }
});

client.login(TOKEN);
