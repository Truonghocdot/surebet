type FixtureParticipants = {
  homeTeam: string;
  awayTeam: string;
};

const parentheticalPattern = /\s*\([^)]*\)/gu;
const danglingParenthesisPattern = /\s*\(.*$/u;

export function canonicalFixtureKey({ homeTeam, awayTeam }: FixtureParticipants) {
  const home = canonicalParticipantName(homeTeam);
  const away = canonicalParticipantName(awayTeam);
  if (!home || !away || home === away) {
    return "";
  }

  return [home, away].sort((left, right) => left.localeCompare(right)).join(" vs ");
}

function canonicalParticipantName(value: string) {
  const canonical = canonicalText(stripParticipantAnnotations(value.normalize("NFKD")));
  const tokens = canonical
    .split(" ")
    .filter(Boolean)
    .map(normalizeParticipantAliasToken);
  while (tokens[0] === "fc") {
    tokens.shift();
  }
  while (tokens[tokens.length - 1] === "fc") {
    tokens.pop();
  }
  return tokens.length > 0 ? tokens.join(" ") : canonical;
}

function stripParticipantAnnotations(value: string) {
  return value.replace(parentheticalPattern, "").replace(danglingParenthesisPattern, "");
}

function normalizeParticipantAliasToken(value: string) {
  switch (value) {
    case "akademia":
      return "academy";
    case "kobenhavn":
      return "copenhagen";
    default:
      return value;
  }
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
