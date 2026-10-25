import { parseRankingsRoute, rankingsSearch } from "./rankingsRoute";

/**
 * The GameChanger crawl's files handed to Team Rankings' Import with no download and no upload.
 *
 * The owner's crawler is a userscript in their own browser. When a run finishes it leaves its NEW
 * Teams and Organizations exports in the userscript's own storage, and a second copy of the same
 * userscript, running on this page, posts them here. This module is what crosses that line: the
 * messages read and written, checked as data, since a page can be posted to by anything running in
 * it. Nothing here pulls, fetches or stores: a file handed over goes where the same file chosen by
 * hand goes, and costs what that costs.
 */

export const HANDOFF_CHANNEL = "league-forecast/crawl-handoff";
export const HANDOFF_VERSION = 1;

/**
 * The longest file of each kind taken, in characters. A nationwide team export runs to about 270
 * bytes a line, and the largest lists seen were about 450,000 teams, some 125 MB; 256 Mi characters
 * is double that and still under the longest string a browser will build. Organizations list team
 * ids at about 14 characters each, so a quarter of that is ample.
 */
export const HANDOFF_LIMITS = { teamsChars: 268_435_456, orgsChars: 67_108_864 } as const;

export type HandoffKind = "teams" | "orgs";
export type HandedFile = { name: string; text: string };
export type HandoffRefusal = "version" | "id" | "no-files" | "empty" | "too-big" | "name";

export type HandoffRead =
  | { kind: "ignore" }
  | { kind: "hello" }
  | { kind: "files"; id: string; teams: HandedFile | null; orgs: HandedFile | null }
  | { kind: "refuse"; id: string | null; reason: HandoffRefusal };

const HANDOFF_ID = /^[A-Za-z0-9_-]{1,64}$/;
const NAME_MAX = 255;
const DEFAULT_NAMES: Record<HandoffKind, string> = {
  teams: "GC_Teams_New.csv",
  orgs: "GC_Organizations_New.csv",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One message posted to this page, read as the hand-off. Only this page's own window, at its own
 * origin, on the hand-off's channel and from the miner's side, is listened to: anything else is
 * ignored without an answer, since answering a stranger would tell it someone is listening.
 */
export const readHandoffMessage = (
  event: { origin: string; source: unknown; data: unknown },
  self: { origin: string; window: unknown },
  limits: { teamsChars: number; orgsChars: number } = HANDOFF_LIMITS
): HandoffRead => {
  const { data } = event;
  if (event.origin !== self.origin || event.source !== self.window) return { kind: "ignore" };
  if (!isRecord(data) || data.channel !== HANDOFF_CHANNEL || data.from !== "miner") {
    return { kind: "ignore" };
  }
  if (data.type === "hello") return { kind: "hello" };
  if (data.type !== "files") return { kind: "ignore" };
  const id = typeof data.id === "string" && HANDOFF_ID.test(data.id) ? data.id : null;
  if (data.v !== HANDOFF_VERSION) return { kind: "refuse", id, reason: "version" };
  if (!id) return { kind: "refuse", id: null, reason: "id" };
  const read = (kind: HandoffKind, max: number): HandedFile | HandoffRefusal | null => {
    const file = data[kind];
    if (file === undefined || file === null) return null;
    if (!isRecord(file) || typeof file.text !== "string") return "empty";
    if (file.text.length === 0) return "empty";
    if (file.text.length > max) return "too-big";
    if (file.name !== undefined && (typeof file.name !== "string" || file.name.length > NAME_MAX))
      return "name";
    const name =
      typeof file.name === "string" && file.name.trim() ? file.name : DEFAULT_NAMES[kind];
    return { name, text: file.text };
  };
  const teams = read("teams", limits.teamsChars);
  const orgs = read("orgs", limits.orgsChars);
  for (const one of [teams, orgs])
    if (typeof one === "string") return { kind: "refuse", id, reason: one };
  if (!teams && !orgs) return { kind: "refuse", id, reason: "no-files" };
  return {
    kind: "files",
    id,
    teams: typeof teams === "string" ? null : teams,
    orgs: typeof orgs === "string" ? null : orgs,
  };
};

const envelope = { channel: HANDOFF_CHANNEL, v: HANDOFF_VERSION, from: "app" } as const;

/** The page is listening, and how much it takes: on mount, and in answer to every hello. */
export const readyMessage = (limits = HANDOFF_LIMITS) => ({ ...envelope, type: "ready", limits });

/** A files message was taken, or refused and why. */
export const ackMessage = (id: string | null, accepted: boolean, reason?: HandoffRefusal) => ({
  ...envelope,
  type: "ack",
  id,
  accepted,
  ...(reason ? { reason } : {}),
});

/** One of the files is where the same file chosen by hand would be: the miner's commit point. */
export const loadedMessage = (id: string, kind: HandoffKind) => ({
  ...envelope,
  type: "loaded",
  id,
  kind,
});

/** The file a consumer applies, as its own file input would have handed it one. */
export const handedFile = ({ name, text }: HandedFile): File =>
  new File([text], name, { type: "text/csv" });

/** This page's query string with Team Rankings' Import open, everything else kept. */
export const crawlImportSearch = (search: string): string =>
  rankingsSearch(search, { ...parseRankingsRoute(search), mode: "rankings", section: "import" });
