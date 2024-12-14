import BasePlugin from "./base-plugin.js";
import { default as PlaytimeSearcher, TIME_IS_UNKNOWN } from "./playtime-searcher.js";

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
      number_of_messages_to_victim: {
        required: false,
        description: "The number of messages that will be sent to the victim",
        default: 1,
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.steam_api = new PlaytimeSearcher(this.options.steam_key);

    this.lastAttacker = new Map();

    this.onWound = this.onWound.bind(this);
    this.sendMessageToAttacker = this.sendMessageToAttacker.bind(this);
  }

  async mount() {
    this.server.on("PLAYER_WOUNDED", async (data) => {
      if (data.attacker && data.victim) {
        await this.onWound(data);
      }
    });

    for (const index in this.options.commands) {
      this.server.on(`CHAT_COMMAND:${this.options.commands[index]}`, async (data) => {
        if (data.message && data.player) {
          await this.sendMessageToAttacker(data);
        }
      });
    }
  }

  async sendMessageToAttacker(data) {
    const attacker = this.lastAttacker.get(data.player.steamID);

    if (attacker) {
      this.lastAttacker.delete(data.player.steamID);
      await this.warn(attacker.steamID, `${data.player.name} передал: ${data.message}`, 2);
      await this.warn(data.player.steamID, `Твоё сообщение передано игроку ${attacker.name}!`);
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

    let attackerPlaytimeObj = await this.steam_api.getPlaytimeByGame(data.attacker.steamID, SQUAD_GAME_ID);

    if (attackerPlaytimeObj.playtime !== TIME_IS_UNKNOWN) {
      await this.warn(
        data.victim.steamID,
        `Ты убит врагом ${data.attacker.name} с ${attackerPlaytimeObj.playtime.toFixed(0)} часами\n\n!reply ТЕКСТ отправит ему сообщение`,
        this.options.number_of_messages_to_victim
      );
    } else {
      await this.warn(
        data.victim.steamID,
        `Ты убит врагом ${data.attacker.name}\n\n!reply ТЕКСТ отправит ему сообщение`,
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
