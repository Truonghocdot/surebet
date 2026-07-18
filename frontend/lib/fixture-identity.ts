type FixtureParticipants = {
  homeTeam: string;
  awayTeam: string;
};

export type FixtureIdentity = {
  key: string;
  participants: [string, string];
};

export type FixtureIdentityIndexEntry = {
  id: string;
  sourceId: string;
  identity: FixtureIdentity;
};

const parentheticalPattern = /\s*\([^)]*\)/gu;
const danglingParenthesisPattern = /\s*\(.*$/u;
export const FIXTURE_SIMILARITY_THRESHOLD = 0.4;
const WORD_SIMILARITY_THRESHOLD = 0.4;

export function createFixtureIdentity({
  homeTeam,
  awayTeam
}: FixtureParticipants): FixtureIdentity | null {
  const home = canonicalParticipantName(homeTeam);
  const away = canonicalParticipantName(awayTeam);
  if (!home || !away || home === away) {
    return null;
  }

  const participants = [home, away].sort((left, right) =>
    left.localeCompare(right)
  ) as [string, string];
  return {
    key: participants.join(" vs "),
    participants
  };
}

function canonicalParticipantName(value: string) {
  const canonical = canonicalText(stripParticipantAnnotations(value.normalize("NFKD")));
  const tokens = canonical
    .split(" ")
    .filter(Boolean);
  const normalizedTokens = canonicalParticipantTokens(tokens);
  return normalizedTokens.length > 0 ? normalizedTokens.join(" ") : canonical;
}

function stripParticipantAnnotations(value: string) {
  return value.replace(parentheticalPattern, "").replace(danglingParenthesisPattern, "");
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
    value === "sk" ||
    value === "team"
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

export function fixtureIdentitySimilarity(
  left: FixtureIdentity,
  right: FixtureIdentity
) {
  const direct = fixtureOrientationMatches(
    left.participants[0],
    left.participants[1],
    right.participants[0],
    right.participants[1]
  );
  const reversed = fixtureOrientationMatches(
    left.participants[0],
    left.participants[1],
    right.participants[1],
    right.participants[0]
  );
  const matches = Math.max(direct, reversed);
  if (matches === 0) {
    return 0;
  }

  const leftTokenCount = participantTokenCount(left.participants[0]) +
    participantTokenCount(left.participants[1]);
  const rightTokenCount = participantTokenCount(right.participants[0]) +
    participantTokenCount(right.participants[1]);
  const denominator = Math.max(leftTokenCount, rightTokenCount);
  return denominator > 0 ? matches / denominator : 0;
}

export function indexFixtureIdentities(entries: FixtureIdentityIndexEntry[]) {
  const entriesBySource = new Map<string, FixtureIdentityIndexEntry[]>();
  for (const entry of entries) {
    const current = entriesBySource.get(entry.sourceId) ?? [];
    current.push(entry);
    entriesBySource.set(entry.sourceId, current);
  }

  const clusters: Array<{
    key: string;
    representative: FixtureIdentity;
    sourceIds: Set<string>;
  }> = [];
  const clusterKeyByEntry = new Map<string, string>();
  const sourceIds = Array.from(entriesBySource.keys()).sort((left, right) =>
    left.localeCompare(right)
  );

  for (const sourceId of sourceIds) {
    const sourceEntries = [...(entriesBySource.get(sourceId) ?? [])].sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    const candidates = sourceEntries.flatMap((entry, entryIndex) =>
      clusters.flatMap((cluster, clusterIndex) => {
        if (cluster.sourceIds.has(sourceId)) {
          return [];
        }
        const score = fixtureIdentitySimilarity(entry.identity, cluster.representative);
        return score > FIXTURE_SIMILARITY_THRESHOLD
          ? [{ entryIndex, clusterIndex, score }]
          : [];
      })
    );
    candidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const entryOrder = sourceEntries[left.entryIndex].id.localeCompare(
        sourceEntries[right.entryIndex].id
      );
      return entryOrder !== 0
        ? entryOrder
        : clusters[left.clusterIndex].key.localeCompare(clusters[right.clusterIndex].key);
    });

    const assignedEntries = new Set<number>();
    const assignedClusters = new Set<number>();
    for (const candidate of candidates) {
      if (
        assignedEntries.has(candidate.entryIndex) ||
        assignedClusters.has(candidate.clusterIndex)
      ) {
        continue;
      }
      const entry = sourceEntries[candidate.entryIndex];
      const cluster = clusters[candidate.clusterIndex];
      cluster.sourceIds.add(sourceId);
      clusterKeyByEntry.set(entry.id, cluster.key);
      assignedEntries.add(candidate.entryIndex);
      assignedClusters.add(candidate.clusterIndex);
    }

    for (let index = 0; index < sourceEntries.length; index += 1) {
      if (assignedEntries.has(index)) {
        continue;
      }
      const entry = sourceEntries[index];
      const clusterKey = uniqueClusterKey(clusters, entry.identity.key);
      clusters.push({
        key: clusterKey,
        representative: entry.identity,
        sourceIds: new Set([sourceId])
      });
      clusterKeyByEntry.set(entry.id, clusterKey);
    }
  }

  return clusterKeyByEntry;
}

function uniqueClusterKey(
  clusters: Array<{ key: string }>,
  base: string
) {
  const used = new Set(clusters.map((cluster) => cluster.key));
  if (!used.has(base)) {
    return base;
  }
  let suffix = 2;
  while (used.has(`${base} #${suffix}`)) {
    suffix += 1;
  }
  return `${base} #${suffix}`;
}

function fixtureOrientationMatches(
  leftHome: string,
  leftAway: string,
  rightHome: string,
  rightAway: string
) {
  const homeMatches = participantTokenMatches(leftHome, rightHome);
  const awayMatches = participantTokenMatches(leftAway, rightAway);
  return homeMatches > 0 && awayMatches > 0 ? homeMatches + awayMatches : 0;
}

function participantTokenCount(value: string) {
  return value.split(" ").filter(Boolean).length;
}

function participantTokenMatches(left: string, right: string) {
  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  const adjacency = leftTokens.map((leftToken) =>
    rightTokens.flatMap((rightToken, rightIndex) =>
      wordsMatch(leftToken, rightToken) ? [rightIndex] : []
    )
  );
  const matchedLeftByRight = Array.from<number>({ length: rightTokens.length }).fill(-1);
  let matches = 0;

  for (let leftIndex = 0; leftIndex < leftTokens.length; leftIndex += 1) {
    if (
      matchParticipantToken(
        leftIndex,
        adjacency,
        matchedLeftByRight,
        new Set<number>()
      )
    ) {
      matches += 1;
    }
  }
  return matches;
}

function matchParticipantToken(
  leftIndex: number,
  adjacency: number[][],
  matchedLeftByRight: number[],
  seenRight: Set<number>
): boolean {
  for (const rightIndex of adjacency[leftIndex]) {
    if (seenRight.has(rightIndex)) {
      continue;
    }
    seenRight.add(rightIndex);
    if (
      matchedLeftByRight[rightIndex] === -1 ||
      matchParticipantToken(
        matchedLeftByRight[rightIndex],
        adjacency,
        matchedLeftByRight,
        seenRight
      )
    ) {
      matchedLeftByRight[rightIndex] = leftIndex;
      return true;
    }
  }
  return false;
}

function wordsMatch(left: string, right: string) {
  if (left === right) {
    return true;
  }
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  if (leftChars.length < 4 || rightChars.length < 4) {
    return false;
  }
  const denominator = Math.max(leftChars.length, rightChars.length);
  return 1 - levenshteinDistance(leftChars, rightChars) / denominator >
    WORD_SIMILARITY_THRESHOLD;
}

function levenshteinDistance(left: string[], right: string[]) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const cost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current[rightIndex + 1] = Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + cost
      );
    }
    previous = current;
  }
  return previous[right.length];
}
