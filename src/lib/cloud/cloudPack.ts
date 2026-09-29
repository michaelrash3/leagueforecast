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

export type PackedValue = {
  /** SHA-256 of the value's JSON, hex. */
  hash: string;
  /** The JSON's length in bytes, before compression, for saying how large a copy is. */
  bytes: number;
  chunks: Uint8Array<ArrayBuffer>[];
};

/** The fingerprint alone, for a value this device only needs to compare. */
export const hashValue = async (value: unknown): Promise<string> =>
  sha256Hex(new TextEncoder().encode(JSON.stringify(value ?? null)));

export const packValue = async (value: unknown): Promise<PackedValue> => {
  const text = new TextEncoder().encode(JSON.stringify(value ?? null));
  const [hash, zipped] = await Promise.all([
    sha256Hex(text),
    pipe(text, new CompressionStream("gzip")),
  ]);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < zipped.length; at += CHUNK_BYTES) {
    chunks.push(zipped.slice(at, at + CHUNK_BYTES));
  }
  return { hash, bytes: text.length, chunks };
};

/** A value back from its pieces, in order. Throws on anything that is not what was packed. */
export const unpackChunks = async (chunks: readonly Uint8Array[]): Promise<unknown> => {
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  const text = await pipe(joined, new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(text));
};
