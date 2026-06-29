import type {
  BookmakerCode,
  BookmakerSetting,
  BookmakerSettingsProvider
} from "../contracts.js";

type BackendResponse = {
  data: Array<{
    bookmaker_code: BookmakerCode;
    bookmaker_name: string;
    url: string;
    username: string;
    password: string;
  }>;
};

export class BackendSettingsProvider implements BookmakerSettingsProvider {
  constructor(private readonly backendURL: string) {}

  async getBookmakerSetting(bookmakerCode: BookmakerCode): Promise<BookmakerSetting> {
    const response = await fetch(
      `${this.backendURL.replace(/\/+$/, "")}/v1/bookmaker-settings`
    );

    if (!response.ok) {
      throw new Error(`Failed to load bookmaker setting for ${bookmakerCode}.`);
    }

    const payload = (await response.json()) as BackendResponse;
    const item = payload.data.find((entry) => entry.bookmaker_code === bookmakerCode);

    if (!item) {
      throw new Error(`Bookmaker setting ${bookmakerCode} not found.`);
    }

    return {
      bookmakerCode: item.bookmaker_code,
      bookmakerName: item.bookmaker_name,
      url: item.url,
      username: item.username,
      password: item.password
    };
  }
}

