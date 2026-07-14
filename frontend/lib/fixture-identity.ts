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
  return canonicalText(value.normalize("NFKD").replace(neutralVenueSuffix, ""));
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
