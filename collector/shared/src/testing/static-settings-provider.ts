import type {
  BookmakerCode,
  BookmakerSetting,
  BookmakerSettingsProvider
} from "../contracts.js";

type SettingsMap = Record<BookmakerCode, BookmakerSetting>;

export class StaticSettingsProvider implements BookmakerSettingsProvider {
  constructor(private readonly settings: SettingsMap) {}

  async getBookmakerSetting(bookmakerCode: BookmakerCode): Promise<BookmakerSetting> {
    const setting = this.settings[bookmakerCode];
    if (!setting) {
      throw new Error(`Missing static setting for ${bookmakerCode}.`);
    }

    return setting;
  }
}

