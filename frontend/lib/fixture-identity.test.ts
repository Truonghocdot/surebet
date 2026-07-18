import assert from "node:assert/strict";
import test from "node:test";
import {
  createFixtureIdentity,
  fixtureIdentitySimilarity
} from "@/lib/fixture-identity";

test("matches Vietnamese and English national team names", () => {
  const vietnamese = createFixtureIdentity({ homeTeam: "Pháp", awayTeam: "Anh" });
  const english = createFixtureIdentity({ homeTeam: "France", awayTeam: "England" });

  assert.ok(vietnamese);
  assert.ok(english);
  assert.equal(fixtureIdentitySimilarity(vietnamese, english), 1);
  assert.equal(vietnamese.key, english.key);
});

test("preserves national youth qualifiers", () => {
  const vietnamese = createFixtureIdentity({ homeTeam: "Pháp U21", awayTeam: "Anh U21" });
  const english = createFixtureIdentity({ homeTeam: "France U21", awayTeam: "England U21" });

  assert.ok(vietnamese);
  assert.ok(english);
  assert.equal(fixtureIdentitySimilarity(vietnamese, english), 1);
});

test("does not replace country words embedded in club names", () => {
  const club = createFixtureIdentity({
    homeTeam: "Paris France FC",
    awayTeam: "London England FC"
  });

  assert.ok(club);
  assert.match(club.key, /france paris/);
  assert.match(club.key, /england london/);
});
