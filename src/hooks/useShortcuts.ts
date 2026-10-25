import { useEffect } from "react";

export type Shortcut = {
  combo: string; // "d", "shift+/", "mod+s"
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
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
};

export function useShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const matches = (event: KeyboardEvent, combo: string) => {
      const tokens = combo.toLowerCase().split("+");
      const key = tokens[tokens.length - 1];
      if (tokens.includes("mod") !== isMod(event)) return false;
      if (tokens.includes("shift") !== event.shiftKey) return false;
      if (tokens.includes("alt") !== event.altKey) return false;
      return event.key.toLowerCase() === key;
    };

    const handler = (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        if (!shortcut.allowInInput && isTypingTarget(event.target)) continue;
        if (matches(event, shortcut.combo)) {
          event.preventDefault();
          shortcut.handler(event);
          return;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}
