//@ts-check
import Sequelize from "sequelize";
import BasePlugin from "./base-plugin.js";
import { default as PlaytimeServiceAPI, TIME_IS_UNKNOWN } from "./playtime-service-api.js";

const { DataTypes, QueryTypes } = Sequelize;

const SQUAD_GAME_ID = 393380;

export default class ShowAttacker extends BasePlugin {
  static get description() {
    return "The plugin that shows attacker";
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      playtime_service_api_url: {
        required: true,
        description: "URL to Playtime Service API",
        default: "",
      },
      playtime_service_api_secret_key: {
        required: true,
        description: "Secret key for Playtime Service API",
        default: "",
      },

      commands: {
        required: false,
        description: "Commands to respond to attack",
        default: ["reply", "отомстить", "мстя"],
      },
      use_alter_names: {
        required: false,
        description: "Whether to user alter name system",
        default: true,
      },
      use_alter_labels: {
        required: false,
        description: "Whether to user alter label system",
        default: true,
      },
      update_name_commands: {
        required: false,
        description: "Commands for update alter names",
        default: ["имя", "name"],
      },
      remove_name_commands: {
        required: false,
        description: "Commands for remove alternative names",
        default: ["сброситьимя", "removename"],
      },
      show_real_attacker_name_commands: {
        required: false,
        description: "Commands for show real attacker's name",
        default: ["настоящееимя", "realname"],
      },
      update_label_commands: {
        required: false,
        description: "Commands for update label",
        default: ["подпись", "label"],
      },
      remove_label_commands: {
        required: false,
        description: "Commands for remove label",
        default: ["удалитьподпись", "removelabel"],
      },

      is_need_clear_wounds_on_new_game: {
        required: false,
        default: false,
      },

      show_my_message_commands: {
        required: false,
        description: "Commands for show full user's message",
        default: ["моесообщение", "showmessage", "mymessage", "моёсообщение"],
      },

      max_name_length: {
        required: false,
        description: "The max chars in player name",
        default: 100,
      },

      max_label_length: {
        required: false,
        description: "The max chars in label",
        default: 100,
      },

      number_of_messages_to_victim: {
        required: false,
        description: "The number of messages that will be sent to the victim",
        default: 1,
      },

      database: {
        required: false,
        connector: "sequelize",
        description: "The Sequelize connector to alternative player names.",
        default: "mysql",
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.playerAlterName = this.options.database.define(
      "ShowAttacker_PlayerAlterName",
      {
        steamID: { type: DataTypes.STRING, allowNull: false, unique: true },
        name: { type: DataTypes.TEXT },
        label: { type: DataTypes.TEXT },
      },
      {
        tableName: "ShowAttacker_PlayerAlterNames",
      }
    );

    this.playtimeAPI = new PlaytimeServiceAPI(
      this.options.playtime_service_api_url,
      this.options.playtime_service_api_secret_key,
      SQUAD_GAME_ID
    );

    this.lastAttacker = new Map();

    this.playersWounds = new Map();

    this.onWound = this.onWound.bind(this);
    this.sendMessageToAttacker = this.sendMessageToAttacker.bind(this);
    this.getPlayerFromDB = this.getPlayerFromDB.bind(this);
  }

  async prepareToMount() {
    if (this.options.use_alter_names) {
      await this.playerAlterName.sync();
    }
  }

  async mount() {
    this.server.on("NEW_GAME", (data) => {
      if (this.options.is_need_clear_wounds_on_new_game) {
        this.playersWounds.clear();
      }
    });

    this.server.on("PLAYER_WOUNDED", (data) => {
      this.verbose(
        2,
        `${data.attacker?.steamID} ${data.attacker?.name} kill ${data.victim?.steamID} ${data.victim?.steamID}`
      );
      if (data.attacker?.steamID && data.victim?.steamID) {
        this.onWound(data);
      }
    });

    for (const command of this.options.commands) {
      this.server.on(`CHAT_COMMAND:${command}`, (data) => {
        if (data.message && data.player?.steamID) {
          this.sendMessageToAttacker(data);
        }
      });
    }

    if (this.options.use_alter_labels || this.options.use_alter_names) {
      for (const command of this.options.show_my_message_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.player?.steamID) {
            this.showMyMessage(data);
          }
        });
      }
    }

    if (this.options.use_alter_names) {
      for (const command of this.options.update_name_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.message && data.player?.steamID) {
            this.updateName(data);
          }
        });
      }
      for (const command of this.options.remove_name_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.player?.steamID) {
            this.removeName(data);
          }
        });
      }
      for (const command of this.options.show_real_attacker_name_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.player?.steamID) {
            this.showRealAttackerName(data);
          }
        });
      }
    }

    if (this.options.use_alter_labels) {
      for (const command of this.options.update_label_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.message && data.player?.steamID) {
            this.updateLabel(data);
          }
        });
      }

      for (const command of this.options.remove_label_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.player?.steamID) {
            this.removeLabel(data);
          }
        });
      }
    }
  }

  async updateName(data) {
    if (data.message.length > this.options.max_name_length) {
      await this.warn(data.player.steamID, `Максимальная длина имени ${this.options.max_name_length}`);
      return;
    }

    await this.playerAlterName.upsert({
      steamID: data.player.steamID,
      name: data.message,
    });

    await this.warn(
      data.player.steamID,
      `Обновили твоё имя\n\n!${this.options.remove_name_commands[0]}\n!${this.options.show_my_message_commands[0]}`
    );

    this.verbose(1, `Игрок ${data.player.steamID} обновил имя на ${data.message}`);
  }

  async updateLabel(data) {
    if (data.message.length > this.options.max_label_length) {
      await this.warn(data.player.steamID, `Максимальная длина подписи ${this.options.max_label_length}`);
      return;
    }

    await this.playerAlterName.upsert({
      steamID: data.player.steamID,
      label: data.message,
    });

    await this.warn(
      data.player.steamID,
      `Обновили твою подпись\n\n!${this.options.remove_label_commands[0]}\n!${this.options.show_my_message_commands[0]}`
    );

    this.verbose(1, `Игрок ${data.player.steamID} обновил свою подпись на ${data.message}`);
  }

  async removeName(data) {
    await this.playerAlterName.upsert({
      steamID: data.player.steamID,
      name: null,
    });

    await this.warn(data.player.steamID, "Вернули тебе стандартное имя");

    this.verbose(1, `Игрок ${data.player.steamID} сбросил имя`);
  }

  async removeLabel(data) {
    await this.playerAlterName.upsert({
      steamID: data.player.steamID,
      label: null,
    });

    await this.warn(data.player.steamID, "Вернули тебе стандартную подпись");

    this.verbose(1, `Игрок ${data.player.steamID} сбросил подпись`);
  }

  async showMyMessage(data) {
    await this.warn(data.player.steamID, await this.assembleAttackerMessage(data.player));
  }

  async showRealAttackerName(data) {
    const attacker = this.lastAttacker.get(data.player.steamID);

    if (attacker) {
      await this.warn(data.player.steamID, `Реальное имя твоего последнего убийцы: ${attacker.name}`);
    } else {
      await this.warn(data.player.steamID, "Не нашли твоего последнего убийцу");
    }
  }

  async sendMessageToAttacker(data) {
    const attacker = this.lastAttacker.get(data.player.steamID);

    if (!attacker) {
      await this.warn(data.player.steamID, `Не нашли твоего последнего убийцу`);
      return;
    }

    if (attacker.isReplySent) {
      await this.warn(data.player.steamID, `Ты уже отправлял сообщение`);
      return;
    }

    attacker.isReplySent = true;

    let attackerName;
    let playerName;

    if (this.options.use_alter_names) {
      attackerName = (await this.getPlayerFromDB(attacker.steamID))?.name || attacker.name;
      playerName = (await this.getPlayerFromDB(data.player.steamID))?.name || data.player.name;
    } else {
      attackerName = attacker.name;
      playerName = data.player.name;
    }

    await this.warn(attacker.steamID, `${playerName} передал: ${data.message}`, 2);
    await this.warn(data.player.steamID, `Твоё сообщение передано игроку ${attackerName}!`);
  }

  async onWound(data) {
    if (data.teamkill) {
      await Promise.all([
        this.warn(data.victim.steamID, `Ты убит игроком твоей команды ${data.attacker.name}`, 1),
        this.warn(data.attacker.steamID, `Ты убил союзника! ${data.victim.name}. Извинись перед ним!`, 2),
      ]);
      return;
    }

    let victimWounds = this.playersWounds.get(data.victim.steamID);
    let attackerWounds = this.playersWounds.get(data.attacker.steamID);

    if (!victimWounds) {
      victimWounds = new PlayerWounds();
      this.playersWounds.set(data.victim.steamID, victimWounds);
    }

    if (!attackerWounds) {
      attackerWounds = new PlayerWounds();
      this.playersWounds.set(data.attacker.steamID, attackerWounds);
    }

    attackerWounds.addWound(data.victim.steamID);
    this.lastAttacker.set(data.victim.steamID, { ...data.attacker, isReplySent: false });

    await this.warn(
      data.victim.steamID,
      await this.assembleAttackerMessage(
        data.attacker,
        victimWounds.getWounds(data.attacker.steamID),
        attackerWounds.getWounds(data.victim.steamID)
      ),
      this.options.number_of_messages_to_victim
    );

    if (this.server?.currentLayer?.gamemode === "Seed") {
      const victimPlaytime = await this.getPlayerPlaytime(data.victim.steamID);
      const victimPlaytimeText = victimPlaytime === TIME_IS_UNKNOWN ? "" : ` с ${victimPlaytime.toFixed(0)} часами`;

      await this.warn(
        data.attacker.steamID,
        `Ты убил игрока '${data.victim.name}'${victimPlaytimeText}\n\nПродолжай :-) Это сообщение есть только на seed`
      );
    }
  }

  async assembleAttackerMessage(player, victimWounds = 0, attackerWounds = 0) {
    const playerDB = await this.getPlayerFromDB(player.steamID);
    const playerPlaytime = await this.getPlayerPlaytime(player.steamID);

    let name;
    if (this.options.use_alter_names) {
      name = playerDB?.name || player.name;
    } else {
      name = player.name;
    }

    let label;
    if (this.options.use_alter_labels) {
      label = playerDB?.label || "!reply ТЕКСТ отправит ему твоё сообщение";
    } else {
      label = "!reply ТЕКСТ отправит ему твоё сообщение";
    }

    let playtimeText = playerPlaytime === TIME_IS_UNKNOWN ? "" : ` с ${playerPlaytime.toFixed(0)} часами`;

    return `➼ врагом '${name}'${playtimeText}\nЛичный счет: ${victimWounds} vs ${attackerWounds}\n\n${label}`;
  }

  async getPlayerFromDB(steamID) {
    return await this.playerAlterName.findOne({
      where: {
        steamID: steamID,
      },
    });
  }

  async getPlayerPlaytime(steamID) {
    try {
      const playtimeSec = await this.playtimeAPI.getPlayerMaxSecondsPlaytime(steamID);

      if (playtimeSec === TIME_IS_UNKNOWN) {
        return playtimeSec;
      }

      return playtimeSec / 60 / 60;
    } catch (error) {
      this.verbose(1, `Failed to get playtime for ${steamID} with error: ${error}`);
      return TIME_IS_UNKNOWN;
    }
  }

  async warn(playerID, message, repeat = 1, frequency = 5) {
    for (let i = 0; i < repeat; i++) {
      // repeat используется для того, чтобы squad выводил все сообщения, а не скрывал их из-за того, что они одинаковые
      await this.server.rcon.warn(playerID, message + "\u{00A0}".repeat(i).slice(0, 97)); // max symbols by rcon - 97

      if (i !== repeat - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }
}

class PlayerWounds {
  constructor() {
    this.wounds = new Map();
  }

  addWound(steamID) {
    const wounds = this.wounds.get(steamID) || 0;

    this.wounds.set(steamID, wounds + 1);
  }

  getWounds(steamID) {
    return this.wounds.get(steamID) || 0;
  }
}
