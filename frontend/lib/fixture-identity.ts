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
  trimGenericClubAffixes(tokens);
  return tokens.length > 0 ? tokens.join(" ") : canonical;
}

function stripParticipantAnnotations(value: string) {
  return value.replace(parentheticalPattern, "").replace(danglingParenthesisPattern, "");
}

function normalizeParticipantAliasToken(value: string) {
  switch (value) {
    case "akademia":
      return "academy";
    case "amedspor":
      return "amed";
    case "kobenhavn":
      return "copenhagen";
    default:
      return value;
  }
}

function isGenericClubToken(value: string | undefined) {
  return value === "fc" || value === "fk" || value === "sk" || value === "sc" || value === "if";
}

function isNumericClubPrefix(value: string | undefined) {
  return value === "1";
}

function trimGenericClubAffixes(tokens: string[]) {
  while (tokens.length > 0) {
    if (isGenericClubToken(tokens[0])) {
      tokens.shift();
      continue;
    }
    if (tokens.length > 1 && isNumericClubPrefix(tokens[0]) && isGenericClubToken(tokens[1])) {
      tokens.shift();
      tokens.shift();
      continue;
    }
    break;
  }

  while (isGenericClubToken(tokens[tokens.length - 1])) {
    tokens.pop();
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
