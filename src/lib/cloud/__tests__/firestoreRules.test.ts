import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  Bytes,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore/lite";
import { CHUNK_BYTES } from "../cloudPack";
import { commitChanges, fetchValues } from "../cloudEngine";
import { chunkId, DATA_SCHEMA, MANIFEST_FORMAT, type CloudManifest } from "../cloudManifest";
import { firestoreMembers, firestoreStore, ownsCopy, UnreadableCopyError } from "../firebaseCloud";
import { coercePullJob, jobPath, jobPiecePath, newPullJob, packJobList } from "../pullJobs";
import { createMemberCheck } from "../../memberCheck";
import { coerceLiveMeta, publishViews } from "../../live/viewStore";
import { firestoreRestDocuments, firestoreRestLive } from "../firestoreRest";
import { coerceLedger, REBUILD_LEDGER_PATH, restLedgerStore } from "../../live/rebuildLedger";
import { unpackChunks } from "../cloudPack";

/*
 * The rules that open the cloud copy to the Google accounts on its list and to nothing else, and
 * the list to its owner, tried against a real
 * Firestore: the emulator that `npm run test:rules` starts, which loads `firestore.rules` from
 * `firebase.json` just as a deploy does. The ordinary run has no emulator to talk to and skips it.
 *
 * Each "account" is its own Firebase app holding the emulator's stand-in for a signed-in token,
 * which the rules read as `request.auth` exactly as they read a real one, down to the way it was
 * signed in (`firebase.sign_in_provider`).
 */
const HOST = import.meta.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-league-forecast";

const apps: FirebaseApp[] = [];

type Account = {
  uid: string;
  email?: string;
  provider?: "google.com" | "anonymous" | "password";
  /** An address Google has not verified belongs to the account. */
  unverified?: true;
};

/** The owner, whose own entry on the list says so (made in the console, here by `seed`). */
const OWNER: Account = { uid: "owner", email: "owner@example.com", provider: "google.com" };
/** An account the owner has put on the list: another device of theirs, or someone else's. */
const LAPTOP: Account = { uid: "laptop", email: "laptop@example.com", provider: "google.com" };
/** A Google account nobody put on the list. */
const STRANGER: Account = {
  uid: "stranger",
  email: "stranger@example.com",
  provider: "google.com",
};

/** Firestore as `account` sees it, or as a browser nobody has signed in to. */
const as = (account: Account | null): Firestore => {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key" }, `app-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  const [host = "127.0.0.1", port = "8085"] = (HOST ?? "").split(":");
  connectFirestoreEmulator(
    db,
    host,
    Number(port),
    account
      ? {
          mockUserToken: {
            sub: account.uid,
            ...(account.email === undefined
              ? {}
              : { email: account.email, email_verified: account.unverified === undefined }),
            ...(account.provider === undefined
              ? {}
              : { firebase: { sign_in_provider: account.provider, identities: {} } }),
          },
        }
      : {}
  );
  return db;
};

const REFUSED = { code: "permission-denied" };

const manifestOf = (version: number): CloudManifest => ({
  format: MANIFEST_FORMAT,
  schema: DATA_SCHEMA,
  copy: "copy-a",
  version,
  save: `save-${version}`,
  updatedAt: "2026-09-28T00:00:00.000Z",
  device: "d",
  parts: [],
  kept: [],
});

const firstCopy = async (db: Firestore, values: Record<string, unknown>) => {
  const result = await commitChanges({
    store: firestoreStore(db),
    base: null,
    changes: Object.entries(values).map(([key, value]) => ({ key, value, at: 1 })),
    device: "phone",
    now: "2026-09-28T00:00:00.000Z",
  });
  if (!result.ok) throw new Error("first copy refused");
  return result.manifest;
};

/** Every way into the copy an account could try: read, write, list and delete. */
const expectShutOut = async (db: Firestore): Promise<void> => {
  const store = firestoreStore(db);
  await expect(store.readManifest()).rejects.toMatchObject(REFUSED);
  await expect(store.commitManifest(null, manifestOf(1))).rejects.toMatchObject(REFUSED);
  await expect(store.putChunk("a-0", new Uint8Array([1, 2, 3]))).rejects.toMatchObject(REFUSED);
  await expect(store.getChunk("a-0")).rejects.toMatchObject(REFUSED);
  await expect(store.deleteChunk("a-0")).rejects.toMatchObject(REFUSED);
};

/**
 * Writes an entry on the list as the console does, past the rules: the emulator takes a bearer
 * token of `owner` for an administrator.
 */
const seed = async (address: string, role: "owner" | "member") => {
  const response = await fetch(
    `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents/members/${address}`,
    {
      method: "PATCH",
      headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { role: { stringValue: role } } }),
    }
  );
  if (!response.ok) throw new Error(`seeding ${address} failed: ${response.status}`);
};

beforeEach(async () => {
  if (!HOST) return;
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE",
  });
  await seed("owner@example.com", "owner");
  await seed("laptop@example.com", "member");
});

afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

describe.skipIf(!HOST)("the cloud copy's rules, on the Firestore emulator", () => {
  it("give a browser nobody has signed in to nothing at all", async () => {
    await expectShutOut(as(null));
  });

  it("give a sign-in that is not Google's nothing, whatever address it carries", async () => {
    await expectShutOut(as({ uid: "anon", provider: "anonymous" }));
    await expectShutOut(as({ uid: "typed", email: "owner@example.com", provider: "password" }));
    // A token that says nothing of how it was signed in, as the emulator makes by default.
    await expectShutOut(as({ uid: "owner", email: "owner@example.com" }));
  });

  it("give a Google account nobody put on the list nothing, nor one whose address is unverified", async () => {
    await expectShutOut(as(STRANGER));
    await expectShutOut(as({ ...LAPTOP, unverified: true }));
  });

  it("read the list's addresses in lower case, as Google may hand one back in any", async () => {
    const shouting = as({ ...LAPTOP, email: "Laptop@Example.COM" });
    expect(await firestoreStore(shouting).readManifest()).toBeNull();
  });

  it("tell an account whether it may open the copy, by a look that changes nothing", async () => {
    expect(await ownsCopy(as(OWNER))).toBe(true);
    expect(await ownsCopy(as(LAPTOP))).toBe(true);
    expect(await ownsCopy(as(STRANGER))).toBe(false);
    expect(await ownsCopy(as({ uid: "anon", provider: "anonymous" }))).toBe(false);
    expect(await ownsCopy(as(null))).toBe(false);
    expect(await firestoreStore(as(OWNER)).readManifest()).toBeNull();
  });

  it("open nothing but the copy, the list and the views, even to a Google sign-in", async () => {
    const owner = as(OWNER);
    await expect(setDoc(doc(owner, "config/owner"), { uid: "owner" })).rejects.toMatchObject(
      REFUSED
    );
    await expect(setDoc(doc(owner, "elsewhere/doc"), { x: 1 })).rejects.toMatchObject(REFUSED);
    await expect(getDoc(doc(owner, "elsewhere/doc"))).rejects.toMatchObject(REFUSED);
  });

  it("carry the data from one Google sign-in to another, and to nothing else", async () => {
    const values = { league: { seasons: [{ name: "Spring" }] }, teams: [["a", "Hawks"]] };
    const sent = await firstCopy(as(OWNER), values);
    const laptopStore = firestoreStore(as(LAPTOP));
    const manifest = (await laptopStore.readManifest()) as CloudManifest;
    expect(manifest.parts.map((part) => part.key)).toEqual(["league", "teams"]);
    expect(manifest.save).toBe(sent.save);
    const fetched = await fetchValues({ store: laptopStore, parts: manifest.parts });
    expect(fetched.ok && Object.fromEntries(fetched.values)).toEqual(values);

    const anonymous = firestoreStore(as({ uid: "anon", provider: "anonymous" }));
    const piece = chunkId(manifest.parts[0]?.id ?? "", 0);
    await expect(anonymous.readManifest()).rejects.toMatchObject(REFUSED);
    await expect(anonymous.getChunk(piece)).rejects.toMatchObject(REFUSED);
    await expect(anonymous.putChunk(piece, new Uint8Array([0]))).rejects.toMatchObject(REFUSED);
    await expect(anonymous.deleteChunk(piece)).rejects.toMatchObject(REFUSED);
    await expect(
      anonymous.commitManifest({ version: 1, copy: manifest.copy }, manifestOf(2))
    ).rejects.toMatchObject(REFUSED);
  });

  it("refuse a save onto a copy that moved on, or onto another copy, in one step with the read", async () => {
    const store = firestoreStore(as(OWNER));
    expect(await store.commitManifest(null, manifestOf(1))).toBe(true);
    expect(await store.commitManifest(null, manifestOf(1))).toBe(false);
    expect(await store.commitManifest({ version: 1, copy: "copy-a" }, manifestOf(2))).toBe(true);
    expect(await store.commitManifest({ version: 1, copy: "copy-a" }, manifestOf(3))).toBe(false);
    expect(await store.commitManifest({ version: 2, copy: "copy-b" }, manifestOf(3))).toBe(false);
    expect((await store.readManifest())?.version).toBe(2);
  });

  it("never take a manifest this build cannot read for no copy at all", async () => {
    const owner = as(OWNER);
    // A later build's layout, as this one would find it.
    await setDoc(doc(owner, "copies/main"), { ...manifestOf(4), format: MANIFEST_FORMAT + 1 });
    const store = firestoreStore(owner);
    await expect(store.readManifest()).rejects.toBeInstanceOf(UnreadableCopyError);
    // Nor write a first copy over it.
    expect(await store.commitManifest(null, manifestOf(1))).toBe(false);
    expect((await getDoc(doc(owner, "copies/main"))).get("format")).toBe(MANIFEST_FORMAT + 1);
  });

  it("fit a value too large for one document into several", async () => {
    // Random text, so gzip cannot shrink it under one piece.
    const bytes = new Uint8Array(CHUNK_BYTES * 2);
    for (let at = 0; at < bytes.length; at += 65_536) {
      crypto.getRandomValues(bytes.subarray(at, at + 65_536));
    }
    const noise = Array.from(bytes, (byte) => byte.toString(36)).join("");
    const manifest = await firstCopy(as(OWNER), { teams: noise });
    expect(manifest.parts[0]?.chunks).toBeGreaterThan(1);
    const fetched = await fetchValues({ store: firestoreStore(as(OWNER)), parts: manifest.parts });
    expect(fetched.ok && fetched.values.get("teams")).toBe(noise);
  }, 60_000);

  it("take a pull a Google sign-in leaves beside the copy, and give it to no one else", async () => {
    const job = "0123456789abcdef0123456789abcdef";
    const packed = await packJobList([{ teamId: "gcACES000001" }]);
    const sent = newPullJob({
      list: packed.list,
      seasonYears: [2027],
      timeZone: "America/New_York",
      device: "phone",
      now: "2026-09-29T12:00:00.000Z",
    });
    const owner = as(OWNER);
    await setDoc(doc(owner, jobPiecePath(job, 0)), {
      data: Bytes.fromUint8Array(packed.pieces[0]!),
    });
    await setDoc(doc(owner, jobPath(job)), sent);
    // Read back as the function reads it, by another device of the same person.
    const laptop = as(LAPTOP);
    expect(coercePullJob((await getDoc(doc(laptop, jobPath(job)))).data())).toEqual(sent);
    expect((await getDoc(doc(laptop, jobPiecePath(job, 0)))).get("data").toUint8Array()).toEqual(
      packed.pieces[0]
    );
    for (const outsider of [as(null), as({ uid: "anon", provider: "anonymous" })]) {
      await expect(getDoc(doc(outsider, jobPath(job)))).rejects.toMatchObject(REFUSED);
      await expect(setDoc(doc(outsider, jobPath(job)), sent)).rejects.toMatchObject(REFUSED);
    }
  });
});

describe.skipIf(!HOST)("the list of who may use the copy, on the Firestore emulator", () => {
  const NOW = "2026-10-02T12:00:00.000Z";
  const listAs = (account: Account) => firestoreMembers(as(account), () => account.email ?? null);

  it("tells each account its own place on it, and a stranger none", async () => {
    expect(await listAs(OWNER).role()).toBe("owner");
    expect(await listAs(LAPTOP).role()).toBe("member");
    expect(await listAs(STRANGER).role()).toBeNull();
    expect(await firestoreMembers(as(null), () => null).role()).toBeNull();
  });

  it("is read whole by its owner and by nobody else", async () => {
    expect((await listAs(OWNER).list()).map((member) => member.address)).toEqual([
      "owner@example.com",
      "laptop@example.com",
    ]);
    await expect(listAs(LAPTOP).list()).rejects.toMatchObject(REFUSED);
    await expect(listAs(STRANGER).list()).rejects.toMatchObject(REFUSED);
    // A member reads its own entry, and no other.
    await expect(getDoc(doc(as(LAPTOP), "members/owner@example.com"))).rejects.toMatchObject(
      REFUSED
    );
  });

  it("lets the owner put an account on it, which then opens the copy", async () => {
    await expectShutOut(as(STRANGER));
    await listAs(OWNER).add("Stranger@Example.com", NOW);
    expect(await listAs(STRANGER).role()).toBe("member");
    expect(await firestoreStore(as(STRANGER)).readManifest()).toBeNull();
  });

  it("lets the owner take an account off it, which then shuts it out", async () => {
    await listAs(OWNER).remove("laptop@example.com");
    await expectShutOut(as(LAPTOP));
  });

  it("never lets the owner's own entry be taken off or changed from the app", async () => {
    await expect(listAs(OWNER).remove("owner@example.com")).rejects.toMatchObject(REFUSED);
    await expect(
      setDoc(doc(as(OWNER), "members/owner@example.com"), { role: "member", addedAt: NOW })
    ).rejects.toMatchObject(REFUSED);
    expect(await listAs(OWNER).role()).toBe("owner");
  });

  it("takes only a plain member, under an address in lower case, and changes no entry", async () => {
    const owner = as(OWNER);
    for (const [id, data] of [
      ["second@example.com", { role: "owner", addedAt: NOW }],
      ["second@example.com", { role: "member", addedAt: NOW, prefs: {} }],
      ["second@example.com", { role: "member" }],
      ["Second@example.com", { role: "member", addedAt: NOW }],
      ["nobody", { role: "member", addedAt: NOW }],
    ] as const) {
      await expect(setDoc(doc(owner, "members", id), data)).rejects.toMatchObject(REFUSED);
    }
    // An entry already there is not written over, not even with what it holds.
    await expect(
      setDoc(doc(owner, "members/laptop@example.com"), { role: "member", addedAt: NOW })
    ).rejects.toMatchObject(REFUSED);
  });

  it("is changed by nobody but its owner", async () => {
    for (const account of [LAPTOP, STRANGER]) {
      const members = listAs(account);
      await expect(members.add("third@example.com", NOW)).rejects.toMatchObject(REFUSED);
      // Neither its own entry nor anyone else's, the owner's included.
      await expect(members.remove("laptop@example.com")).rejects.toMatchObject(REFUSED);
      await expect(members.remove("owner@example.com")).rejects.toMatchObject(REFUSED);
    }
    expect(await listAs(OWNER).role()).toBe("owner");
    await expect(
      setDoc(doc(as(LAPTOP), "members/laptop@example.com"), { role: "owner", addedAt: NOW })
    ).rejects.toMatchObject(REFUSED);
    await expect(deleteDoc(doc(as(null), "members/laptop@example.com"))).rejects.toMatchObject(
      REFUSED
    );
    await expect(getDocs(collection(as(null), "members"))).rejects.toMatchObject(REFUSED);
  });
});

describe.skipIf(!HOST)(
  "the GameChanger proxy's check against the list, on the Firestore emulator",
  () => {
    /**
     * A sign-in token as the emulator takes one: Firebase's claims, unsigned, which is what the
     * SDK's own stand-in (`mockUserToken`) sends. Firestore in production checks the signature too.
     */
    const tokenOf = (account: Account): string => {
      const iat = Math.floor(Date.now() / 1000);
      const encode = (value: unknown) =>
        btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return `${encode({ alg: "none", type: "JWT" })}.${encode({
        iss: `https://securetoken.google.com/${PROJECT}`,
        aud: PROJECT,
        iat,
        exp: iat + 3_600,
        auth_time: iat,
        sub: account.uid,
        user_id: account.uid,
        ...(account.email === undefined
          ? {}
          : { email: account.email, email_verified: account.unverified === undefined }),
        firebase: { sign_in_provider: account.provider ?? "google.com", identities: {} },
      })}.`;
    };
    const verdictFor = (account: Account | null) =>
      createMemberCheck({ projectId: PROJECT, origin: `http://${HOST}` })(
        account ? `Bearer ${tokenOf(account)}` : undefined
      );

    it("lets in the accounts on the list, whatever case Google hands their address back in", async () => {
      expect(await verdictFor(OWNER)).toBe("member");
      expect(await verdictFor(LAPTOP)).toBe("member");
      expect(await verdictFor({ ...LAPTOP, email: "Laptop@Example.COM" })).toBe("member");
    });

    it("turns away everyone else, as the rules do", async () => {
      expect(await verdictFor(STRANGER)).toBe("not-member");
      expect(await verdictFor({ ...LAPTOP, unverified: true })).toBe("not-member");
      expect(await verdictFor({ ...LAPTOP, provider: "password" })).toBe("not-member");
      expect(await verdictFor(null)).toBe("signed-out");
    });

    it("follows the list: an account put on it is let in, and one taken off is turned away", async () => {
      await firestoreMembers(as(OWNER), () => OWNER.email ?? null).add(
        "stranger@example.com",
        "now"
      );
      expect(await verdictFor(STRANGER)).toBe("member");
      await firestoreMembers(as(OWNER), () => OWNER.email ?? null).remove("laptop@example.com");
      expect(await verdictFor(LAPTOP)).toBe("not-member");
    });
  }
);

describe.skipIf(!HOST)("the views a server publishes, on the Firestore emulator", () => {
  /** `live/` as the server writes it, past the rules, as an administrator. */
  const server = (fetchImpl?: typeof fetch) =>
    firestoreRestLive({
      projectId: PROJECT,
      token: async () => "owner",
      origin: `http://${HOST}`,
      writable: true,
      fetchImpl,
    });
  const T = "2027-04-15T12:00:00.000Z";
  const KEY = "board:2027:ag_10u_2027:year";
  const VIEW = { rows: [{ teamId: "S-A", rating: 1.5 }] };
  const published = async () => {
    const result = await publishViews({
      store: server(),
      views: [{ key: KEY, value: VIEW }],
      owns: ["board:"],
      copy: { id: "copy-a", version: 1 },
      today: "2027-04-15",
      now: T,
    });
    if (!result.ok) throw new Error("publish refused");
    const entry = coerceLiveMeta((await server().readMeta())?.meta)?.views[KEY];
    if (!entry) throw new Error("no entry");
    return entry;
  };

  it("are read by the accounts on the list, the meta and every piece it names", async () => {
    const entry = await published();
    for (const account of [OWNER, LAPTOP, { ...LAPTOP, email: "Laptop@Example.COM" }]) {
      const db = as(account);
      const meta = await getDoc(doc(db, "live/meta"));
      expect(coerceLiveMeta(meta.data())?.views[KEY]).toEqual(entry);
      const piece = await getDoc(doc(db, `live/meta/chunks/${entry.id}-0`));
      const data = piece.get("data") as Bytes;
      expect(await unpackChunks([data.toUint8Array()], entry.h)).toEqual(VIEW);
    }
  });

  it("are read by nobody else", async () => {
    const entry = await published();
    for (const account of [
      null,
      { uid: "anon", provider: "anonymous" as const },
      { uid: "typed", email: "owner@example.com", provider: "password" as const },
      STRANGER,
      { ...LAPTOP, unverified: true as const },
    ]) {
      const db = as(account);
      await expect(getDoc(doc(db, "live/meta"))).rejects.toMatchObject(REFUSED);
      await expect(getDoc(doc(db, `live/meta/chunks/${entry.id}-0`))).rejects.toMatchObject(
        REFUSED
      );
    }
  });

  it("are never listed, even by the owner", async () => {
    await published();
    await expect(getDocs(collection(as(OWNER), "live/meta/chunks"))).rejects.toMatchObject(REFUSED);
    await expect(getDocs(collection(as(OWNER), "live"))).rejects.toMatchObject(REFUSED);
  });

  it("are written by no browser, the owner's included", async () => {
    const entry = await published();
    const before = (await getDoc(doc(as(OWNER), "live/meta"))).data();
    for (const account of [OWNER, LAPTOP, STRANGER, null]) {
      const db = as(account);
      await expect(setDoc(doc(db, "live/meta"), { format: 1 })).rejects.toMatchObject(REFUSED);
      await expect(updateDoc(doc(db, "live/meta"), { today: "x" })).rejects.toMatchObject(REFUSED);
      await expect(deleteDoc(doc(db, "live/meta"))).rejects.toMatchObject(REFUSED);
      await expect(
        setDoc(doc(db, "live/meta/chunks/0123456789abcdef-0"), {
          data: Bytes.fromUint8Array(new Uint8Array([1])),
        })
      ).rejects.toMatchObject(REFUSED);
      await expect(deleteDoc(doc(db, `live/meta/chunks/${entry.id}-0`))).rejects.toMatchObject(
        REFUSED
      );
      await expect(setDoc(doc(db, "live/other"), { x: 1 })).rejects.toMatchObject(REFUSED);
    }
    expect((await getDoc(doc(as(OWNER), "live/meta"))).data()).toEqual(before);
  });

  it("follow the list: an account taken off is shut out, one put on is let in", async () => {
    await published();
    const owner = firestoreMembers(as(OWNER), () => OWNER.email ?? null);
    await owner.remove("laptop@example.com");
    await expect(getDoc(doc(as(LAPTOP), "live/meta"))).rejects.toMatchObject(REFUSED);
    await owner.add("stranger@example.com", "now");
    expect((await getDoc(doc(as(STRANGER), "live/meta"))).exists()).toBe(true);
  });

  it("are replaced by the server only over the version it read, as in production", async () => {
    await published();
    const store = server();
    const read = await store.readMeta();
    const meta = coerceLiveMeta(read?.meta);
    if (!read || !meta) throw new Error("no meta");
    expect(await store.commitMeta(null, meta)).toBe(false);
    expect(await store.commitMeta(read.token, { ...meta, today: "2027-04-16" })).toBe(true);
    expect(await store.commitMeta(read.token, meta)).toBe(false);
  });

  it("are listed by the server by name and age only, none of their data", async () => {
    const entry = await published();
    const answers: Array<{ documents?: Array<{ fields?: object }> }> = [];
    const recording: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (String(input).includes("/live/meta/chunks?")) answers.push(await response.clone().json());
      return response;
    };
    const pieces = await server(recording).listChunks();
    expect(pieces.map(({ id }) => id)).toEqual([`${entry.id}-0`]);
    expect(Number.isNaN(Date.parse(pieces[0]?.createdAt ?? ""))).toBe(false);
    // As Firestore answered, before the store kept only names and times: no piece's bytes came.
    const listed = answers.flatMap((answer) => answer.documents ?? []);
    expect(listed).toHaveLength(1);
    expect(listed.map((found) => Object.keys(found.fields ?? {}))).toEqual([[]]);
  });
});

describe.skipIf(!HOST)("the rebuilds' switch and ledger, on the Firestore emulator", () => {
  /** `ops/rebuild` as a rebuild reads and writes it, past the rules, as an administrator. */
  const server = () =>
    restLedgerStore(
      firestoreRestDocuments({
        projectId: PROJECT,
        token: async () => "owner",
        origin: `http://${HOST}`,
      })
    );
  const SWITCH = { on: true, mode: "dry", warm: true };

  it("are read and written by the server alone, only over the version it read", async () => {
    const store = server();
    expect(await store.read()).toEqual({ raw: null, token: null });
    const ledger = coerceLedger(SWITCH);
    if (!ledger) throw new Error("no ledger");
    expect(await store.replace(null, ledger)).toBe(true);
    const read = await store.read();
    expect(coerceLedger(read.raw)).toEqual(ledger);
    expect(await store.replace(null, ledger)).toBe(false);
    expect(await store.replace(read.token, { ...ledger, dayGiBs: 9 })).toBe(true);
    expect(await store.replace(read.token, ledger)).toBe(false);
  });

  it("are closed to every browser: no read, list or write, the owner's and a member's included", async () => {
    const ledger = coerceLedger(SWITCH);
    if (!ledger) throw new Error("no ledger");
    await server().replace(null, ledger);
    const before = (await server().read()).raw;
    for (const account of [OWNER, LAPTOP, STRANGER, null]) {
      const db = as(account);
      const where = doc(db, REBUILD_LEDGER_PATH);
      await expect(getDoc(where)).rejects.toMatchObject(REFUSED);
      await expect(getDocs(collection(db, "ops"))).rejects.toMatchObject(REFUSED);
      await expect(setDoc(where, { on: true, mode: "live" })).rejects.toMatchObject(REFUSED);
      await expect(updateDoc(where, { dayGiBs: 0 })).rejects.toMatchObject(REFUSED);
      await expect(deleteDoc(where)).rejects.toMatchObject(REFUSED);
      await expect(setDoc(doc(db, "ops/other"), { on: true })).rejects.toMatchObject(REFUSED);
    }
    expect((await server().read()).raw).toEqual(before);
  });
});
