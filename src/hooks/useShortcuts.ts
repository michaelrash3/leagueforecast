import { useEffect } from "react";

export type Shortcut = {
  combo: string; // "mod+k", "?", "g s"
  description: string;
  group?: string;
  handler: (event: KeyboardEvent) => void;
  // Allow firing while typing in an input. Default false.
  allowInInput?: boolean;
};

const isMod = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;
const isTypingTarget = (target: EventTarget | null) => {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
  );
};

type ChordState = {
  prefix: string | null;
  expiresAt: number;
};

const CHORD_WINDOW_MS = 900;

export function useShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    let chord: ChordState = { prefix: null, expiresAt: 0 };

    const matches = (event: KeyboardEvent, combo: string) => {
      const parts = combo.toLowerCase().split(" ");
      if (parts.length === 2) {
        // Chord shortcut like "g s"
        if (chord.prefix !== parts[0] || Date.now() > chord.expiresAt) return false;
        return event.key.toLowerCase() === parts[1];
      }
      const tokens = combo.toLowerCase().split("+");
      const key = tokens[tokens.length - 1];
      const wantsMod = tokens.includes("mod");
      const wantsShift = tokens.includes("shift");
      const wantsAlt = tokens.includes("alt");

      if (wantsMod !== isMod(event)) return false;
      if (wantsShift !== event.shiftKey) return false;
      if (wantsAlt !== event.altKey) return false;
      if (event.key.toLowerCase() !== key) return false;
      return true;
    };

    const handler = (event: KeyboardEvent) => {
      // Reset stale chord
      if (chord.prefix && Date.now() > chord.expiresAt) {
        chord = { prefix: null, expiresAt: 0 };
      }

      for (const shortcut of shortcuts) {
        if (!shortcut.allowInInput && isTypingTarget(event.target)) continue;
        if (matches(event, shortcut.combo)) {
          event.preventDefault();
          shortcut.handler(event);
          chord = { prefix: null, expiresAt: 0 };
          return;
        }
      }

      // Possibly start a new chord prefix when nothing matched
      const single = event.key.toLowerCase();
      if (!isTypingTarget(event.target) && !isMod(event) && !event.shiftKey && !event.altKey) {
        const startsAChord = shortcuts.some((s) => s.combo.toLowerCase().startsWith(`${single} `));
        if (startsAChord) {
          chord = { prefix: single, expiresAt: Date.now() + CHORD_WINDOW_MS };
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}
