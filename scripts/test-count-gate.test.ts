import { describe, expect, it } from "vite-plus/test";

import { compare, isRegression, type Suite } from "./test-count-gate.ts";

const suite = (entries: Record<string, ReadonlyArray<string>>): Suite =>
  new Map(Object.entries(entries).map(([path, names]) => [path, { names }]));

const FILE = "apps/server/src/a.test.ts";

describe("test-count-gate", () => {
  it("passes a file that only gained tests", () => {
    const rows = compare(suite({ [FILE]: ["a", "b"] }), suite({ [FILE]: ["a", "b", "c"] }));
    expect(rows.map((row) => [row.before, row.after])).toEqual([[2, 3]]);
    expect(rows.filter(isRegression)).toEqual([]);
  });

  it("fails a file that lost a test", () => {
    const rows = compare(suite({ [FILE]: ["a", "b", "c"] }), suite({ [FILE]: ["a", "b"] }));
    expect(rows.filter(isRegression).map((row) => row.path)).toEqual([FILE]);
    expect(rows[0]?.lost).toEqual(["c"]);
  });

  it("fails a name that vanished even though the COUNT went up", () => {
    // THE CASE A COUNT CANNOT SEE, and the reason this gate compares names at
    // all. On 2026-09-12 a test was split into three and its fourth property
    // was dropped: the count rose and the guard that property protected sat
    // inert for six hours. Three names in, four out, one of the originals gone.
    const rows = compare(
      suite({ [FILE]: ["pins the cursor", "pins the parent", "pins the sequence"] }),
      suite({ [FILE]: ["pins the cursor", "pins the parent", "pins A", "pins B"] }),
    );
    const [row] = rows;
    // Up by one, and still a regression.
    expect([row?.before, row?.after]).toEqual([3, 4]);
    expect(row?.lost).toEqual(["pins the sequence"]);
    expect(rows.filter(isRegression).length).toBe(1);
  });

  it("counts a file the head no longer runs at all", () => {
    // A deleted file, or one that fails to load: the runner reports nothing for
    // it, which must read as every test lost rather than as a file with no
    // tests to lose.
    const rows = compare(suite({ [FILE]: ["a", "b"] }), suite({}));
    expect([rows[0]?.before, rows[0]?.after]).toEqual([2, 0]);
    expect(rows.filter(isRegression).length).toBe(1);
  });

  it("says nothing about a file neither side runs", () => {
    // Not a row at all — otherwise every deleted fixture in history would
    // appear as a zero-to-zero line and the table would stop being readable,
    // which is how a gate gets ignored.
    expect(compare(suite({}), suite({}))).toEqual([]);
  });

  it("treats a renamed test as a loss and a gain, not as a rename", () => {
    // DELIBERATE, and worth stating because it is the gate's main false
    // positive: renaming a test is indistinguishable from deleting one and
    // adding another, and guessing between them would mean guessing wrong in
    // the direction that hides a deletion. The author explains it with
    // `--allow`, which puts the reason in the PR body.
    const rows = compare(suite({ [FILE]: ["old name"] }), suite({ [FILE]: ["new name"] }));
    expect([rows[0]?.before, rows[0]?.after]).toEqual([1, 1]);
    expect(rows[0]?.lost).toEqual(["old name"]);
    expect(rows.filter(isRegression).length).toBe(1);
  });
});
