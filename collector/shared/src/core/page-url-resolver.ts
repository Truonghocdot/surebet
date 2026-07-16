import { JUN88_LOBBIES } from "../bookmakers/jun88-lobbies.js";
import type { BookmakerCode, LobbyCode } from "../contracts.js";
import { envString } from "./env.js";

const EIGHTXBET_INCOMING_PATH = "/sportEvents/incoming/football?hour=6";
const EIGHTXBET_INPLAY_PATH = "/sportEvents/inplay/football";

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

export function resolveEightXBetInplayPageURL() {
  const directURL = envString("EIGHTXBET_INPLAY_PAGE_URL", "").trim();
  if (directURL !== "") {
    return directURL;
  }

  const baseURL = envString("EIGHTXBET_BASE_URL", "").trim();
  if (baseURL !== "") {
    return new URL(EIGHTXBET_INPLAY_PATH, ensureTrailingSlash(baseURL)).toString();
  }

  const incomingURL = envString("EIGHTXBET_PAGE_URL", "").trim();
  if (incomingURL !== "") {
    return new URL(EIGHTXBET_INPLAY_PATH, incomingURL).toString();
  }

  throw new Error(
    [
      "Missing 8xbet inplay page URL.",
      "Set EIGHTXBET_INPLAY_PAGE_URL to the direct inplay scrape page,",
      `or set EIGHTXBET_BASE_URL so the collector can derive ${EIGHTXBET_INPLAY_PATH}.`
    ].join(" ")
  );
}

function resolveJun88PageURL(lobbyId: LobbyCode) {
  for (const directEnvKey of jun88DirectPageEnvKeys(lobbyId)) {
    const directURL = envString(directEnvKey, "").trim();
    if (directURL !== "") {
      return directURL;
    }
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
    `Missing Jun88 page URL for lobby ${lobbyId}. Set ${jun88DirectPageEnvKeys(lobbyId).join(" or ")} or JUN88_BASE_URL.`
  );
}

function jun88DirectPageEnvKeys(lobbyId: LobbyCode) {
  if (lobbyId === "default") {
    return ["JUN88_PAGE_URL"];
  }

  return ["JUN88_CMD_PAGE_URL"];
}

function jun88LobbyPath(lobbyId: LobbyCode) {
  if (lobbyId === "default") {
    return "/";
  }

  return "/vi-vn/sports-landing/cmd";
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
