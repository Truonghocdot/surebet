import type { Jun88LobbyAccess } from "../contracts.js";

export const JUN88_LOBBIES: Jun88LobbyAccess[] = [
  {
    lobbyId: "ibc",
    launchURL: "https://www.jun888e.ren/vi-vn/sports-landing/ibc",
    expectedOriginPatterns: ["bpd3a3fn.com", "g768ob."]
  },
  {
    lobbyId: "bti",
    launchURL: "https://www.jun888e.ren/vi-vn/sports-landing/bti",
    expectedOriginPatterns: ["442hattrick.com", "prod20355-146486234."]
  },
  {
    lobbyId: "cmd",
    launchURL: "https://www.jun888e.ren/vi-vn/sports-landing/cmd",
    expectedOriginPatterns: ["6688867.com", "ss159."]
  },
  {
    lobbyId: "m8",
    launchURL: "https://www.jun888e.ren/vi-vn/sports-landing/m8",
    expectedOriginPatterns: ["m9ongm9.com", "tdgr008d."]
  }
];
