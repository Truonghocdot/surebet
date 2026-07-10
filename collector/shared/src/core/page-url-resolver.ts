import { JUN88_LOBBIES } from "../bookmakers/jun88-lobbies.js";
import type { BookmakerCode, LobbyCode } from "../contracts.js";
import { envString } from "./env.js";

const EIGHTXBET_INCOMING_PATH = "/sportEvents/incoming/football?hour=6";

export function resolveCollectorPageURL(
  bookmakerCode: BookmakerCode,
  lobbyId: LobbyCode
) {
  if (bookmakerCode === "8xbet") {
    return resolveEightXBetPageURL();
  }

  return resolveJun88PageURL(lobbyId);
}

function resolveEightXBetPageURL() {
  const directURL = envString("EIGHTXBET_PAGE_URL", "").trim();
  if (directURL !== "") {
    return directURL;
  }

  const baseURL = envString("EIGHTXBET_BASE_URL", "").trim();
  if (baseURL !== "") {
    return new URL(EIGHTXBET_INCOMING_PATH, ensureTrailingSlash(baseURL)).toString();
  }

  throw new Error(
    [
      "Missing 8xbet page URL.",
      "Set EIGHTXBET_PAGE_URL to the direct scrape page,",
      `or set EIGHTXBET_BASE_URL so the collector can derive ${EIGHTXBET_INCOMING_PATH}.`
    ].join(" ")
  );
}

function resolveJun88PageURL(lobbyId: LobbyCode) {
  const directEnvKey = jun88DirectPageEnvKey(lobbyId);
  const directURL = envString(directEnvKey, "").trim();
  if (directURL !== "") {
    return directURL;
  }

  const baseURL = envString("JUN88_BASE_URL", "").trim();
  if (baseURL !== "") {
    return new URL(jun88LobbyPath(lobbyId), ensureTrailingSlash(baseURL)).toString();
  }

  const lobby = JUN88_LOBBIES.find((item) => item.lobbyId === lobbyId);
  if (lobby) {
    return lobby.launchURL;
  }

  throw new Error(
    `Missing Jun88 page URL for lobby ${lobbyId}. Set ${directEnvKey} or JUN88_BASE_URL.`
  );
}

function jun88DirectPageEnvKey(lobbyId: LobbyCode) {
  if (lobbyId === "default") {
    return "JUN88_PAGE_URL";
  }

  return `JUN88_${lobbyId.toUpperCase()}_PAGE_URL`;
}

function jun88LobbyPath(lobbyId: LobbyCode) {
  if (lobbyId === "default") {
    return "/";
  }

  return `/vi-vn/sports-landing/${lobbyId}`;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
