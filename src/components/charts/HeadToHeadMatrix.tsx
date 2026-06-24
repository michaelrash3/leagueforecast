import { displayName, teamAbbr } from "../../lib/format";

export type H2HCell = "win" | "loss" | "tie" | "none" | "self";

export function HeadToHeadMatrix({
  teams,
  cellFor,
}: {
  teams: { id: string; name: string }[];
  cellFor: (rowId: string, colId: string) => H2HCell;
}) {
  const tone = (c: H2HCell) => {
    if (c === "win") return "bg-emerald-500";
    if (c === "loss") return "bg-red-500";
    if (c === "tie") return "bg-amber-400";
    if (c === "self") return "bg-slate-800 dark:bg-slate-700";
    return "bg-slate-100 dark:bg-slate-800";
  };
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-[10px] font-black uppercase tracking-wide">
        <thead>
          <tr>
            <th className="p-1" aria-hidden />
            {teams.map((team) => (
              <th
                key={`h-${team.id}`}
                className="p-1 text-slate-500 dark:text-slate-400"
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
                className="p-1 text-right text-slate-500 dark:text-slate-400"
                title={displayName(row.name)}
              >
                {teamAbbr(row.name)}
              </th>
              {teams.map((col) => {
                const c = cellFor(row.id, col.id);
                return (
                  <td
                    key={`c-${row.id}-${col.id}`}
                    className={`h-6 w-6 rounded-sm ${tone(c)}`}
                    title={`${displayName(row.name)} vs ${displayName(col.name)}: ${c}`}
                    aria-label={`${displayName(row.name)} vs ${displayName(col.name)} — ${c}`}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
