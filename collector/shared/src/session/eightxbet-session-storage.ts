import { readFile, writeFile } from "node:fs/promises";

export type EightXBetSessionStorage = Record<string, string>;
export type EightXBetLocalStorage = Record<string, string>;

export async function saveEightXBetSessionStorage(path: string, values: EightXBetSessionStorage) {
  await writeFile(path, JSON.stringify(values, null, 2), "utf8");
}

export async function loadEightXBetSessionStorage(path: string): Promise<EightXBetSessionStorage> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as EightXBetSessionStorage;
}

export async function saveEightXBetLocalStorage(path: string, values: EightXBetLocalStorage) {
  await writeFile(path, JSON.stringify(values, null, 2), "utf8");
}

export async function loadEightXBetLocalStorage(path: string): Promise<EightXBetLocalStorage> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as EightXBetLocalStorage;
}
