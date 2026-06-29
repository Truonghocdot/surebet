import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BookmakerCode,
  SessionState,
  SessionStateStore
} from "../contracts.js";

export class FileSessionStateStore implements SessionStateStore {
  constructor(private readonly baseDir: string) {}

  async read(bookmakerCode: BookmakerCode): Promise<SessionState | null> {
    try {
      const content = await readFile(this.filePath(bookmakerCode), "utf8");
      return JSON.parse(content) as SessionState;
    } catch {
      return null;
    }
  }

  async write(state: SessionState): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.filePath(state.bookmakerCode), JSON.stringify(state, null, 2));
  }

  private filePath(bookmakerCode: BookmakerCode) {
    return path.join(this.baseDir, `${bookmakerCode}-session.json`);
  }
}

