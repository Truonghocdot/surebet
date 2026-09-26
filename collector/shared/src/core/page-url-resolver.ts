import { JUN88_LOBBIES } from "../bookmakers/jun88-lobbies.js";
import { envString } from "./env.js";

const EIGHTXBET_INPLAY_PATH = "/sportEvents/inplay/football";
const JUN88_LOGIN_PATH = "/vi-vn/login";

export function resolveEightXBetLoginURL() {
  const explicitURL = envString("EIGHTXBET_LOGIN_URL", "").trim();
  if (explicitURL !== "") {
    return explicitURL;
  }

  const baseURL = envString("EIGHTXBET_BASE_URL", "https://8x2000.com").trim();
  if (baseURL === "") {
    throw new Error("Missing 8xbet login URL. Set EIGHTXBET_LOGIN_URL or EIGHTXBET_BASE_URL.");
  }

  return new URL("/login", ensureTrailingSlash(baseURL)).toString();
}

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

export function resolveJun88LoginURL() {
  const explicitURL = envString("JUN88_LOGIN_URL", "").trim();
  if (explicitURL !== "") {
    return explicitURL;
  }

  const baseURL = envString("JUN88_BASE_URL", "https://www.junn8811.cc").trim();
  if (baseURL === "") {
    throw new Error("Missing Jun88 login URL. Set JUN88_LOGIN_URL or JUN88_BASE_URL.");
  }

  return new URL(JUN88_LOGIN_PATH, ensureTrailingSlash(baseURL)).toString();
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
