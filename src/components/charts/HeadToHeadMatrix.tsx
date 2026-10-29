import { displayName, teamAbbr } from "../../lib/format";

export type H2HCell = "win" | "loss" | "tie" | "none" | "self";

// What a square says in words: one game is not a series, so it is ahead, behind or even.
const WORDS: Record<H2HCell, string> = {
  win: "ahead",
  loss: "behind",
  tie: "even",
  none: "not played",
  self: "same team",
};

export function HeadToHeadMatrix({
  teams,
  cellFor,
  recordFor,
}: {
  teams: { id: string; name: string }[];
  cellFor: (rowId: string, colId: string) => H2HCell;
  /** The row team's record against the column team ("2-1"), empty where they have not played. */
  recordFor?: (rowId: string, colId: string) => string;
}) {
  const tone = (c: H2HCell) => {
    // Dark enough for the white record on them (5.5:1 and 6.5:1); the 500s were under 4.5:1.
    if (c === "win") return "bg-emerald-700";
    if (c === "loss") return "bg-red-700";
    if (c === "tie") return "bg-amber-400";
    if (c === "self") return "bg-slate-800 dark:bg-slate-700";
    return "bg-slate-100 dark:bg-slate-800";
  };
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs font-semibold uppercase">
        <thead>
          <tr>
            <th className="p-1" aria-hidden />
            {teams.map((team) => (
              <th
                key={`h-${team.id}`}
                // Narrow, so eight teams' initials fit a phone's card without scrolling sideways.
                className="px-0.5 py-1 text-slate-600 dark:text-slate-400"
                title={displayName(team.name)}
              >
                {teamAbbr(team.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((row) => (
            <tr key={`r-${row.id}`}>
              <th
                scope="row"
                className="px-1 py-0.5 text-right text-slate-600 dark:text-slate-400"
                title={displayName(row.name)}
              >
                {teamAbbr(row.name)}
              </th>
              {teams.map((col) => {
                const c = cellFor(row.id, col.id);
                const record = c === "self" ? "" : (recordFor?.(row.id, col.id) ?? "");
                const said = `${displayName(row.name)} vs ${displayName(col.name)}: ${WORDS[c]}${record ? ` ${record}` : ""}`;
                return (
                  <td
                    key={`c-${row.id}-${col.id}`}
                    // The record in the square: a colour alone said who led, not by how much.
                    className={`h-7 min-w-7 rounded-xs px-0.5 text-center text-xs font-black tabular-nums normal-case ${tone(c)} ${c === "tie" ? "text-slate-950" : "text-white"}`}
                    title={said}
                    aria-label={said}
                  >
                    {record}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
