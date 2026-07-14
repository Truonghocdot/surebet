type FixtureParticipants = {
  homeTeam: string;
  awayTeam: string;
};

const neutralVenueSuffix = /\s*\(\s*n\s*\)\s*$/iu;

export function canonicalFixtureKey({ homeTeam, awayTeam }: FixtureParticipants) {
  const home = canonicalParticipantName(homeTeam);
  const away = canonicalParticipantName(awayTeam);
  if (!home || !away || home === away) {
    return "";
  }

  return [home, away].sort((left, right) => left.localeCompare(right)).join(" vs ");
}

function canonicalParticipantName(value: string) {
  const canonical = canonicalText(value.normalize("NFKD").replace(neutralVenueSuffix, ""));
  const tokens = canonical.split(" ").filter(Boolean);
  while (tokens[0] === "fc") {
    tokens.shift();
  }
  while (tokens[tokens.length - 1] === "fc") {
    tokens.pop();
  }
  return tokens.length > 0 ? tokens.join(" ") : canonical;
}

function canonicalText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
