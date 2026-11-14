import { describe, expect, it } from "vitest";
import lockfile from "../../../../package-lock.json?raw";

/*
 * One copy of each of Firebase's packages in an install.
 *
 * Firebase's packages find one another through a registry kept in `@firebase/app`: Firestore and
 * sign-in put themselves on it as their code loads, and `initializeApp` hands out the app they are
 * then looked up on. `firebase` asks for one exact version of every package so that an install
 * has one of each. A lockfile can hold two all the same, and on 14 November 2026 Dependabot's
 * weekly pull request did: it moved `firebase` to 13.2.0, which asks for `@firebase/app` 0.16.5,
 * left 0.16.4 where the rest look for it and set 0.16.5 beside `firebase` alone. Firestore then
 * put itself on one registry and the app came from the other. The built site held both copies in
 * the file that opens the cloud copy, where every signed-in device would have been told "Service
 * firestore/lite is not available", and every check a dependency's pull request runs passed: the
 * unit tests stand in for Firebase, the browser tests do not sign in, and the one test that uses
 * the real thing, the rules test on the emulator, runs only for a change to the rules or the
 * functions. There it failed 43 of its 49.
 *
 * So the lockfile is read here, where every pull request's tests run. With two copies, put the
 * one the others share at the version `firebase` asks for: install that version of the package by
 * name with `--save-exact`, take it out of `package.json` again, and install once more.
 */

type Lock = { packages: Record<string, { version?: string }> };

/** Where each of Firebase's packages is installed, by its name. */
const firebaseCopies = (text: string): Map<string, string[]> => {
  const copies = new Map<string, string[]>();
  for (const [path, entry] of Object.entries((JSON.parse(text) as Lock).packages)) {
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    if (path === "" || (name !== "firebase" && !name.startsWith("@firebase/"))) continue;
    copies.set(name, [...(copies.get(name) ?? []), `${path} ${entry.version ?? "?"}`]);
  }
  return copies;
};

describe("the lockfile's Firebase packages", () => {
  const copies = firebaseCopies(lockfile);

  it("are read: firebase itself, its registry and the rest", () => {
    expect(copies.size).toBeGreaterThan(20);
    expect(copies.has("firebase")).toBe(true);
    expect(copies.has("@firebase/app")).toBe(true);
    expect(copies.has("@firebase/firestore")).toBe(true);
  });

  it("are installed once each", () => {
    const twice = [...copies.values()].filter((paths) => paths.length > 1);
    expect(twice).toEqual([]);
  });

  it("tells two copies of one package from two packages", () => {
    const split = JSON.stringify({
      packages: {
        "": {},
        "node_modules/firebase": { version: "13.2.0" },
        "node_modules/@firebase/app": { version: "0.16.4" },
        "node_modules/@firebase/app-compat": { version: "0.5.21" },
        "node_modules/firebase/node_modules/@firebase/app": { version: "0.16.5" },
        "node_modules/firebase-admin": { version: "14.5.0" },
      },
    });
    const found = firebaseCopies(split);
    expect(found.get("@firebase/app")).toEqual([
      "node_modules/@firebase/app 0.16.4",
      "node_modules/firebase/node_modules/@firebase/app 0.16.5",
    ]);
    expect(found.get("@firebase/app-compat")).toHaveLength(1);
    // Another package whose name only starts the same way is not one of Firebase's client's.
    expect(found.has("firebase-admin")).toBe(false);
  });
});
