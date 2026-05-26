import React from "react";
import { displayName, teamAbbr } from "../lib/format";
import type { GameLog } from "../lib/types";

export const ScoreRow = React.memo(function ScoreRow({
  teamName,
  prefix,
  log,
  onChange,
}: {
  teamName: string;
  prefix: "away" | "home";
  log: GameLog;
  onChange: (field: keyof GameLog, value: string) => void;
}) {
  const fields = [
    { key: `${prefix}Runs` as keyof GameLog, label: "R", aria: "Runs" },
    { key: `${prefix}Hits` as keyof GameLog, label: "H", aria: "Hits" },
    { key: `${prefix}K` as keyof GameLog, label: "K", aria: "Strikeouts" },
  ];
  const display = displayName(teamName);
  const abbr = teamAbbr(teamName);

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">
          {abbr}
        </div>
        <div className="truncate font-bold" title={teamName}>
          {display}
        </div>
      </div>
      <div className="flex gap-2">
        {fields.map((field) => (
          <label key={field.key} className="text-center text-[10px] font-black uppercase text-slate-500">
            {field.label}
            <input
              value={String(log[field.key] ?? "")}
              onChange={(event) => onChange(field.key, event.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              aria-label={`${display} ${field.aria}`}
              className="mt-1 block h-10 w-11 rounded-xl border border-slate-300 bg-white text-center text-base font-black text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
        ))}
      </div>
    </div>
  );
});
