import { JUN88_LOBBIES } from "../bookmakers/jun88-lobbies.js";
import { envString } from "./env.js";

const EIGHTXBET_INPLAY_PATH = "/sportEvents/inplay/football";

export function resolveEightXBetInplayPageURL() {
  const directURL = envString(
    "EIGHTXBET_INPLAY_PAGE_URL",
    "https://8x2000.com/sportEvents/inplay/football"
  ).trim();
  if (directURL !== "") {
    return directURL;
  }

  const baseURL = envString("EIGHTXBET_BASE_URL", "https://8x2000.com").trim();
  if (baseURL !== "") {
    return new URL(EIGHTXBET_INPLAY_PATH, ensureTrailingSlash(baseURL)).toString();
  }

  throw new Error("Unable to resolve the 8xbet in-play page URL.");
}

export function resolveJun88CmdPageURL() {
  const directURL = envString("JUN88_CMD_PAGE_URL", "").trim();
  if (directURL !== "") {
    return directURL;
  }

  const baseURL = envString("JUN88_BASE_URL", "https://www.junn8811.cc").trim();
  if (baseURL !== "") {
    return new URL("/vi-vn/sports-landing/cmd", ensureTrailingSlash(baseURL)).toString();
  }

  const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === "cmd");
  if (lobby) {
    return lobby.launchURL;
  }

  throw new Error(
    "Missing Jun88 CMD page URL. Set JUN88_CMD_PAGE_URL or JUN88_BASE_URL."
  );
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
