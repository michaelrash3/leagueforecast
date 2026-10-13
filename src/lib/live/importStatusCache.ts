import { idbGet, idbSet } from "../idb";
import { coerceQueryAnswer } from "./queryAnswers";
import type { ImportStatus } from "./queries";

// Part of the live cache prefix so a membership refusal clears this snapshot as well.
const key = (uid: string) => `league_forecast_live_view_v1:import-status:${uid}`;
export const cachedImportStatus = async (
  uid: string | null
): Promise<{ answer: ImportStatus; at: string } | null> => {
  if (!uid) return null;
  const raw = await idbGet(key(uid));
  if (
    !raw ||
    typeof raw !== "object" ||
    !("answer" in raw) ||
    !("at" in raw) ||
    typeof raw.at !== "string"
  )
    return null;
  const checked = coerceQueryAnswer(raw.answer, "import.status");
  if (!checked) return null;
  const { kind: _kind, ...answer } = checked;
  return { answer, at: raw.at };
};

export const keepImportStatus = async (
  uid: string | null,
  answer: ImportStatus,
  at: string
): Promise<void> => {
  if (uid) await idbSet(key(uid), { answer: { ...answer, kind: "import.status" }, at });
};
