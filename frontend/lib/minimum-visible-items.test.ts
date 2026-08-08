import assert from "node:assert/strict";
import test from "node:test";
import {
  nextMinimumVisibleExpiry,
  reconcileMinimumVisibleItems
} from "@/lib/minimum-visible-items";

type Item = { id: string; value: number };

test("keeps an item until its minimum visible lifetime elapses", () => {
  const first: Item = { id: "a", value: 1 };
  const entries = reconcileMinimumVisibleItems([], [first], 1_000, 20_000);

  assert.deepEqual(
    reconcileMinimumVisibleItems(entries, [], 20_999, 20_000),
    [{ item: first, firstVisibleAt: 1_000 }]
  );
  assert.deepEqual(reconcileMinimumVisibleItems(entries, [], 21_000, 20_000), []);
});

test("updates an existing item without resetting its visible lifetime", () => {
  const first: Item = { id: "a", value: 1 };
  const updated: Item = { id: "a", value: 2 };
  const entries = reconcileMinimumVisibleItems([], [first], 1_000, 20_000);

  assert.deepEqual(
    reconcileMinimumVisibleItems(entries, [updated], 19_000, 20_000),
    [{ item: updated, firstVisibleAt: 1_000 }]
  );
});

test("reports the next expiry only for items missing from the incoming UI data", () => {
  const entries = reconcileMinimumVisibleItems(
    [],
    [{ id: "a", value: 1 }, { id: "b", value: 2 }],
    1_000,
    20_000
  );

  assert.equal(nextMinimumVisibleExpiry(entries, [{ id: "a", value: 3 }], 5_000, 20_000), 21_000);
  assert.equal(nextMinimumVisibleExpiry(entries, entries.map(({ item }) => item), 5_000, 20_000), null);
});
