import Sequelize from "sequelize";
import BasePlugin from "./base-plugin.js";
import { default as PlaytimeSearcher, TIME_IS_UNKNOWN } from "./playtime-searcher.js";

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
      steam_key: {
        required: true,
        description: "The steam api key",
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
      show_my_name_commands: {
        required: false,
        description: "Commands for show user's name",
        default: ["моеимя", "showname", "myname", "моёимя"],
      },
      max_name_length: {
        required: false,
        description: "The max alter player name",
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

    if (this.options.use_alter_names) {
      this.playerAlterName = this.options.database.define(
        "ShowAttacker_PlayerAlterName",
        {
          steamID: { type: DataTypes.STRING, allowNull: false, unique: true },
          name: { type: DataTypes.TEXT, allowNull: false },
        },
        {
          tableName: "ShowAttacker_PlayerAlterNames",
        }
      );
    }

    this.steam_api = new PlaytimeSearcher(this.options.steam_key);

    this.lastAttacker = new Map();

    this.onWound = this.onWound.bind(this);
    this.sendMessageToAttacker = this.sendMessageToAttacker.bind(this);
  }

  async prepareToMount() {
    if (this.options.use_alter_names) {
      await this.playerAlterName.sync();
    }
  }

  async mount() {
    this.server.on("PLAYER_WOUNDED", async (data) => {
      if (data.attacker && data.victim) {
        await this.onWound(data);
      }
    });

    for (const command of this.options.commands) {
      this.server.on(`CHAT_COMMAND:${command}`, (data) => {
        if (data.message && data.player) {
          this.sendMessageToAttacker(data);
        }
      });
    }

    if (this.options.use_alter_names) {
      for (const command of this.options.update_name_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.message && data.player) {
            this.updateName(data);
          }
        });
      }

      for (const command of this.options.remove_name_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.player) {
            this.removeName(data);
          }
        });
      }
      for (const command of this.options.show_my_name_commands) {
        this.server.on(`CHAT_COMMAND:${command}`, (data) => {
          if (data.player) {
            this.showMyName(data);
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
      `Обновили твоё имя\n\n!${this.options.remove_name_commands[0]}\n!${this.options.show_my_name_commands[0]}`
    );

    this.verbose(1, `Игрок ${data.player.steamID} обновил имя на ${data.message}`);
  }

  async removeName(data) {
    await this.playerAlterName.destroy({
      where: {
        steamID: data.player.steamID,
      },
    });

    await this.warn(data.player.steamID, "Вернули тебе стандартное имя");
    this.verbose(1, `Игрок ${data.player.steamID} сбросил имя`);
  }

  async showMyName(data) {
    const playerName = await this.playerAlterName.findOne({
      where: {
        steamID: data.player.steamID,
      },
    });

    if (playerName === null) {
      await this.warn(data.player.steamID, "У вас стандартное имя по Steam");
      return;
    }

    await this.warn(data.player.steamID, `Ваше текущее имя: ${playerName.name}`);
  }

  async getPlayerName(player) {
    const alterPlayerName = await this.playerAlterName.findOne({
      where: {
        steamID: player.steamID,
      },
    });

    if (alterPlayerName) {
      return alterPlayerName.name;
    } else {
      return player.name;
    }
  }

  async sendMessageToAttacker(data) {
    const attacker = this.lastAttacker.get(data.player.steamID);

    if (attacker) {
      const attackerName = await this.getPlayerName(attacker);

      this.lastAttacker.delete(data.player.steamID);
      await this.warn(attacker.steamID, `${data.player.name} передал: ${data.message}`, 2);
      await this.warn(data.player.steamID, `Твоё сообщение передано игроку ${attackerName}!`);
    } else {
      await this.warn(data.player.steamID, `Некому передавать то`);
    }
  }

  async onWound(data) {
    this.lastAttacker.set(data.victim.steamID, { ...data.attacker });

    if (data.teamkill) {
      await Promise.all([
        this.warn(data.victim.steamID, `Ты убит игроком твоей команды ${data.attacker.name}`, 1),
        this.warn(data.attacker.steamID, `Ты убил союзника! ${data.victim.name}. Извинись перед ним!`, 2),
      ]);
      return;
    }

    const attackerPlaytimeObj = await this.steam_api.getPlaytimeByGame(data.attacker.steamID, SQUAD_GAME_ID);
    const attackerName = await this.getPlayerName(data.attacker);

    if (attackerPlaytimeObj.playtime !== TIME_IS_UNKNOWN) {
      await this.warn(
        data.victim.steamID,
        `Ты убит врагом ${attackerName} с ${attackerPlaytimeObj.playtime.toFixed(0)} часами\n\n!reply ТЕКСТ отправит ему сообщение`,
        this.options.number_of_messages_to_victim
      );
    } else {
      await this.warn(
        data.victim.steamID,
        `Ты убит врагом ${attackerName}\n\n!reply ТЕКСТ отправит ему сообщение`,
        this.options.number_of_messages_to_victim
      );
    }

    if (this.server?.currentLayer?.gamemode === "Seed") {
      let victimPlaytimeObj = await this.steam_api.getPlaytimeByGame(data.victim.steamID, SQUAD_GAME_ID);

      if (victimPlaytimeObj.playtime !== TIME_IS_UNKNOWN) {
        await this.warn(
          data.attacker.steamID,
          `Ты убил игрока ${data.victim.name} с ${victimPlaytimeObj.playtime.toFixed(0)} часами\n\nПродолжай :-) Это сообщение есть только на seed`,
          1
        );
      } else {
        await this.warn(
          data.attacker.steamID,
          `Ты убил игрока ${data.victim.name}\n\nПродолжай :-) Это сообщение есть только на seed`,
          1
        );
      }
    }
  }

  async warn(playerID, message, repeat = 1, frequency = 5) {
    for (let i = 0; i < repeat; i++) {
      // repeat используется для того, чтобы squad выводил все сообщения, а не скрывал их из-за того, что они одинаковые
      await this.server.rcon.warn(playerID, message + "\u{00A0}".repeat(i));

      if (i !== repeat - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }
}
