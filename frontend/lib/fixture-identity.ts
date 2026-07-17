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
  const canonical = normalizeParticipantAliasName(
    canonicalText(stripParticipantAnnotations(value.normalize("NFKD")))
  );
  const tokens = canonical
    .split(" ")
    .filter(Boolean)
    .map(normalizeParticipantAliasToken);
  const normalizedTokens = canonicalParticipantTokens(tokens);
  return normalizedTokens.length > 0 ? normalizedTokens.join(" ") : canonical;
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
    case "mineiro":
      return "mg";
    default:
      return value;
  }
}

function normalizeParticipantAliasName(value: string) {
  switch (value) {
    case "club nacional de football":
    case "nacional de football":
      return "nacional montevideo";
    case "gremio fbpa rs":
    case "gremio porto alegrense":
      return "gremio";
    case "san lorenzo de almagro":
      return "san lorenzo";
    case "club agropecuario argentino":
    case "agropecuario argentino":
      return "agropecuario";
    default:
      return value;
  }
}

function isGenericClubToken(value: string | undefined) {
  return (
    value === "af" ||
    value === "club" ||
    value === "ec" ||
    value === "fc" ||
    value === "fk" ||
    value === "if" ||
    value === "sc" ||
    value === "sk"
  );
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

function canonicalParticipantTokens(tokens: string[]) {
  trimGenericClubAffixes(tokens);
  const normalizedTokens: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (!token.trim() || isGenericClubToken(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    normalizedTokens.push(token);
  }

  normalizedTokens.sort((left, right) => left.localeCompare(right));
  return normalizedTokens;
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
