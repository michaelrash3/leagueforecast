/**
 * One stored value, as the cloud keeps it: gzipped JSON in pieces small enough for a Firestore
 * document, and the SHA-256 of the JSON, which is what says whether two copies are the same.
 *
 * The fingerprint is taken of the JSON rather than of the gzip, because two browsers need not
 * compress the same text to the same bytes, and a device must be able to tell that its copy of a
 * value is the one the cloud holds without downloading it.
 *
 * Written with web APIs only (`CompressionStream`, `crypto.subtle`), which Node has too, so it
 * tests beside the rest of `src/lib`.
 */

/**
 * The largest piece of a value one document carries. A Firestore document holds at most a MiB,
 * name and field included, and a value is sent base64 inside a request of at most 10 MiB; 900 kB
 * leaves room for both.
 */
export const CHUNK_BYTES = 900_000;

/** Bytes through a (de)compression stream. `Response` rather than `Blob`, which jsdom lacks. */
const pipe = async (
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array<ArrayBuffer>> => {
  const body = new Response(bytes).body;
  if (!body) throw new Error("This browser cannot stream bytes");
  return new Uint8Array(await new Response(body.pipeThrough(transform)).arrayBuffer());
};

export const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * A value's JSON and its fingerprint, the two things every save needs of it. Packing is left until
 * a value turns out not to be stored already, which for a nationwide pool is most saves of most of
 * it: gzipping forty megabytes of JSON only to find the cloud holds it is seconds on a phone.
 */
export type HashedValue = {
  /** SHA-256 of the value's JSON, hex. */
  hash: string;
  /** The JSON's length in bytes, before compression, for saying how large a copy is. */
  bytes: number;
  text: Uint8Array<ArrayBuffer>;
};

const jsonOf = (value: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify(value ?? null));

export const hashJson = async (value: unknown): Promise<HashedValue> => {
  const text = jsonOf(value);
  return { hash: await sha256Hex(text), bytes: text.length, text };
};

/** The fingerprint alone, for a value this device only needs to compare. */
export const hashValue = async (value: unknown): Promise<string> => sha256Hex(jsonOf(value));

/** A hashed value's JSON, gzipped and cut into pieces a document can hold. */
export const packHashed = async (value: HashedValue): Promise<Uint8Array<ArrayBuffer>[]> => {
  const zipped = await pipe(value.text, new CompressionStream("gzip"));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < zipped.length; at += CHUNK_BYTES) {
    chunks.push(zipped.slice(at, at + CHUNK_BYTES));
  }
  return chunks;
};

/** Thrown for pieces that do not make the value the manifest says they are. */
export class DamagedValueError extends Error {
  constructor() {
    super("Part of the cloud copy is damaged: its pieces do not make the value the copy names.");
    this.name = "DamagedValueError";
  }
}

/**
 * A value back from its pieces, in order, checked against the fingerprint the manifest gives it.
 * Throws `DamagedValueError` on pieces that do not unpack, or unpack to anything else: a value is
 * never taken on trust from pieces that might be half of one upload and half of another.
 */
export const unpackChunks = async (
  chunks: readonly Uint8Array[],
  hash: string
): Promise<unknown> => {
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  let text: Uint8Array<ArrayBuffer>;
  try {
    text = await pipe(joined, new DecompressionStream("gzip"));
  } catch {
    throw new DamagedValueError();
  }
  if ((await sha256Hex(text)) !== hash) throw new DamagedValueError();
  return JSON.parse(new TextDecoder().decode(text));
};
