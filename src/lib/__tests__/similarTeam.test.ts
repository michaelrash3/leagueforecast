import { describe, expect, it } from "vitest";
import { findSimilarTeam, isPlaceholderName, teamNameKey } from "../teamRankings/names";
import type { ScoutTeam } from "../teamRankings/types";

/*
 * `findSimilarTeam` is asked of every name a schedule pasted on the live page carries, against the
 * cloud's nationwide roster (1.6d). It used to work out every club's key and a full edit distance
 * against each, most of a second a name on 116,485 clubs; it now keeps each club's key and stops
 * an edit distance as soon as it cannot come close. These tests hold it to the answers it gave
 * before, name for name, on rosters made to be full of near misses. Placeholder names throughout.
 */

/** The search as it stood before it was made fast, kept to compare against. */
const editDistanceBefore = (a: string, b: string): number => {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const row = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((row[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = row[j] ?? 0;
  }
  return prev[b.length] ?? 0;
};
const findSimilarTeamBefore = (name: string, teams: ScoutTeam[]): ScoutTeam | null => {
  const key = teamNameKey(name);
  if (key.length < 4 || isPlaceholderName(name)) return null;
  let best: { team: ScoutTeam; score: number } | null = null;
  teams.forEach((team) => {
    const other = teamNameKey(team.name);
    if (other === key || other.length < 4) return;
    const contains = other.startsWith(key) || key.startsWith(other);
    const distance = editDistanceBefore(key, other);
    const ratio = 1 - distance / Math.max(key.length, other.length);
    const score = contains ? Math.max(ratio, 0.9) : ratio;
    if (score < 0.82) return;
    if (!best || score > best.score) best = { team, score };
  });
  return best ? (best as { team: ScoutTeam }).team : null;
};

const PLACES = ["Lexington", "Dayton", "Frisco", "Akron", "Tulsa", "Boise", "Reno", "Ohio", "NV"];
const MASCOTS = ["Stars", "Bandits", "Rays", "Owls", "Foxes", "Storm", "Titans", "Knights", "Stix"];
const TAILS = ["", "", "", " Red", " Blue", " Navy", " - Gold", " Elite", " 9U", " (Smith)", " 2"];

/** A seeded run of numbers in [0, 1), so a failure names the same names every run. */
const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x80000000;
  };
};

/** A name as a typist might get it a little wrong: a letter dropped, doubled, swapped or changed. */
const slip = (name: string, random: () => number): string => {
  const at = Math.floor(random() * name.length);
  const letter = "aeiorstn"[Math.floor(random() * 8)] ?? "a";
  switch (Math.floor(random() * 6)) {
    case 0:
      return name.slice(0, at) + name.slice(at + 1);
    case 1:
      return name.slice(0, at) + letter + name.slice(at);
    case 2:
      return name.slice(0, at) + letter + name.slice(at + 1);
    case 3:
      return name.slice(0, at) + (name[at + 1] ?? "") + (name[at] ?? "") + name.slice(at + 2);
    case 4:
      // A prefix of it, or it with a word more: one name containing the other.
      return random() < 0.5 ? name.slice(0, Math.max(4, at)) : `${name} Scout`;
    default:
      return name.toUpperCase();
  }
};

const rosterOf = (size: number, random: () => number): ScoutTeam[] =>
  Array.from({ length: size }, (_, index) => {
    const pick = (words: string[]) => words[Math.floor(random() * words.length)] ?? "";
    const base = `${pick(PLACES)} ${pick(MASCOTS)}${pick(TAILS)}`;
    // Some the same as another but for a slip, some a few letters, some a slot.
    const name =
      index % 11 === 0
        ? slip(base, random)
        : index % 37 === 0
          ? pick(["TBD", "Rays", "Owl"])
          : base;
    return { id: `S-${index}`, name };
  });

describe("findSimilarTeam made fast", () => {
  it("names the club it named before, for names close to, inside and far from a roster's", () => {
    const random = seeded(29);
    let found = 0;
    for (let round = 0; round < 5; round += 1) {
      const roster = rosterOf(250, random);
      for (let asked = 0; asked < 200; asked += 1) {
        const from = roster[Math.floor(random() * roster.length)]?.name ?? "Rays";
        const name = random() < 0.85 ? slip(from, random) : slip(slip(from, random), random);
        const before = findSimilarTeamBefore(name, roster);
        if (before) found += 1;
        expect([name, findSimilarTeam(name, roster)?.id]).toEqual([name, before?.id]);
      }
    }
    // Most of the names asked are near misses, so this is a test of the matches, not of none.
    expect(found).toBeGreaterThan(600);
  }, 60_000);

  it("keeps the first of the closest, and a whole name contained over a typo", () => {
    const roster: ScoutTeam[] = [
      { id: "A", name: "Dayton Owls Blue" },
      { id: "B", name: "Dayton Owls Bleu" },
      { id: "C", name: "Dayton Owls Blue" },
      { id: "D", name: "Dayton Owlz" },
    ];
    for (const name of ["Dayton Owls Blu", "Dayton Owls", "Dayton Owls Blue Scout", "Daytn Owlz"]) {
      expect([name, findSimilarTeam(name, roster)?.id]).toEqual([
        name,
        findSimilarTeamBefore(name, roster)?.id,
      ]);
    }
    // As close by a typo as another is by a name it begins, and first on the roster: still first,
    // though the names it begins are looked through before the typos.
    const typoFirst = [roster[1]!, roster[0]!];
    expect(findSimilarTeam("Dayton Owls Blu", typoFirst)?.id).toBe("B");
    expect(findSimilarTeamBefore("Dayton Owls Blu", typoFirst)?.id).toBe("B");
  });

  it("looks a name up on a nationwide roster in a few milliseconds", () => {
    const random = seeded(3);
    const roster = rosterOf(116_485, random);
    const names = Array.from({ length: 40 }, (_, index) =>
      slip(roster[index * 997]?.name ?? "Rays", random)
    );
    // Each club's key is worked out once, the first time it is looked through.
    findSimilarTeam("Warm Up Name", roster);
    const started = performance.now();
    for (const name of names) findSimilarTeam(name, roster);
    const perName = (performance.now() - started) / names.length;
    // Measured at 0.7 ms a name here (430 ms before), and at 6.7 ms on the 29 September 2026
    // roster (397 ms before), so a 500-row schedule's thousand names take seconds of the edit
    // function's 60, not minutes.
    expect(perName).toBeLessThan(25);
  });
});
