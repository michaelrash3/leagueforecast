/**
 * Browser side of schedule-screenshot import.
 *
 * Two jobs: get a phone screenshot small enough to post, and talk to
 * `/api/parse-schedule-image` (which holds the Gemini key). As with
 * `leagueSummaryClient.ts`, every failure is returned as data rather than thrown, so the caller can
 * explain the situation and leave manual entry working.
 */

import {
  SCHEDULE_IMAGE_ENDPOINT,
  SCHEDULE_IMAGE_LIMITS,
  sanitizeScheduleImageResponse,
  type ParsedScheduleGame,
  type ScheduleImageError,
  type ScheduleImageRequest,
  type ScheduleImageResponse,
} from "./scheduleImage";
import type { LeagueSummaryErrorReason } from "./leagueSummary";

export type ScheduleImageOutcome =
  | { ok: true; subjectTeam?: string; games: ParsedScheduleGame[]; model: string }
  | { ok: false; reason: LeagueSummaryErrorReason; message: string };

/** Long edge, in pixels, that a screenshot is shrunk to before upload. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("That file could not be read as an image."));
    image.onload = () => resolve(image);
    image.src = dataUrl;
  });

const splitDataUrl = (dataUrl: string): { mimeType: string; imageBase64: string } | null => {
  const match = /^data:([^;,]+)[^,]*,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1] || "image/jpeg", imageBase64: match[2] ?? "" };
};

/**
 * Reads a picked image and shrinks it for upload. Phone screenshots run several megabytes, which
 * is slow on ballfield signal and can exceed the request-body limit; a 1600px JPEG is far smaller
 * and still perfectly legible to the model. Falls back to the original bytes if canvas is
 * unavailable, and reports rather than throws when even that is too large.
 */
export const readImageForUpload = async (
  file: Blob
): Promise<{ ok: true; payload: ScheduleImageRequest } | { ok: false; message: string }> => {
  let dataUrl: string;
  try {
    dataUrl = await readAsDataUrl(file);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read that file." };
  }

  let resized: string | null = null;
  try {
    const image = await loadImage(dataUrl);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (context) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resized = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    }
  } catch {
    // Canvas is unavailable or the image is tainted — fall back to the original bytes.
    resized = null;
  }

  const parts = splitDataUrl(resized ?? dataUrl);
  if (!parts || !parts.imageBase64) {
    return { ok: false, message: "That file could not be read as an image." };
  }
  if (parts.imageBase64.length > SCHEDULE_IMAGE_LIMITS.imageBase64Length) {
    return { ok: false, message: "That image is too large to send. Try a screenshot instead." };
  }
  return { ok: true, payload: parts };
};

export const requestScheduleImageParse = async (
  request: ScheduleImageRequest,
  {
    signal,
    fetchImpl = fetch,
    endpoint = SCHEDULE_IMAGE_ENDPOINT,
  }: { signal?: AbortSignal; fetchImpl?: typeof fetch; endpoint?: string } = {}
): Promise<ScheduleImageOutcome> => {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ScheduleImageError | null;
      // A 404 means the function is not deployed or routed (`vite dev` without `vercel dev`),
      // which sends you somewhere entirely different from "the key is missing".
      const reason =
        payload?.reason ?? (response.status === 404 ? "endpoint-missing" : "upstream-error");
      return {
        ok: false,
        reason,
        message:
          payload?.error ??
          (response.status === 404
            ? `No function is deployed at ${endpoint}.`
            : `Could not read that screenshot (${response.status}).`),
      };
    }

    // A 200 that is not JSON means the SPA fallback answered instead of the function.
    const payload = (await response
      .json()
      .catch(() => null)) as Partial<ScheduleImageResponse> | null;
    if (!payload) {
      return {
        ok: false,
        reason: "endpoint-missing",
        message: `${endpoint} did not return JSON; the function is probably not deployed.`,
      };
    }

    const { subjectTeam, games } = sanitizeScheduleImageResponse(payload);
    if (games.length === 0) {
      return {
        ok: false,
        reason: "upstream-error",
        message: "No games could be read from that screenshot.",
      };
    }
    return { ok: true, ...(subjectTeam ? { subjectTeam } : {}), games, model: payload.model ?? "gemini" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, reason: "upstream-error", message: "Screenshot read cancelled." };
    }
    return {
      ok: false,
      reason: "upstream-error",
      message: error instanceof Error ? error.message : "Could not read that screenshot.",
    };
  }
};
