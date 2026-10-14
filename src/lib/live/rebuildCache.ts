import { inBatches } from "../cloud/cloudEngine";
import { hashJson, packHashed, unpackChunks } from "../cloud/cloudPack";
import type { FirestoreRestDocuments } from "../cloud/firestoreRest";
import { BOARD_HALVES, type BoardBuildCache, type PageBoard } from "./views/board";

/** Private, hash-checked build checkpoints. The existing artifacts TTL removes old generations. */
export const restBoardBuildCache = (
  docs: Pick<FirestoreRestDocuments, "read" | "set">,
  namespace = ""
): BoardBuildCache => {
  const path = (key: string, piece: string) => `rebuildCache/${key}/artifacts/${piece}`;
  return {
    namespace,
    read: async (key) => {
      const meta = await docs.read(path(key, "boards"));
      if (
        typeof meta?.hash !== "string" ||
        !/^[0-9a-f]{64}$/.test(meta.hash) ||
        !Number.isSafeInteger(meta.pieces) ||
        Number(meta.pieces) < 1
      )
        return null;
      const chunks: Uint8Array[] = [];
      for (let n = 0; n < Number(meta.pieces); n++) {
        const chunk = await docs.read(path(key, `${meta.hash}-${n}`));
        if (!(chunk?.data instanceof Uint8Array)) return null;
        chunks.push(chunk.data);
      }
      try {
        const boards = await unpackChunks(chunks, meta.hash);
        return Array.isArray(boards) &&
          boards.every(
            (board) =>
              typeof board?.pageId === "string" &&
              BOARD_HALVES.some(({ half }) => half === board?.half) &&
              Array.isArray(board?.rows)
          )
          ? (boards as PageBoard[])
          : null;
      } catch {
        // A cache is an optimization: damaged or expired work is rebuilt from the source.
        return null;
      }
    },
    write: async (key, boards) => {
      const hashed = await hashJson(boards);
      const chunks = await packHashed(hashed);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
      await inBatches(
        chunks.map((data, n) => ({ data, n })),
        ({ data, n }) => docs.set(path(key, `${hashed.hash}-${n}`), { data, expiresAt })
      );
      await docs.set(path(key, "boards"), { hash: hashed.hash, pieces: chunks.length, expiresAt });
    },
  };
};
