import type { ReactNode } from "react";
import { textRole } from "../styles/tokens";

/**
 * A view's title and the line under it saying what the view is for (2.5), the same on every League
 * view that has one: the title the tab named, so a reader who arrived by a link or the phone's bar
 * still knows where they are, any explanation behind its help button, and what acts on the whole
 * view to its right.
 */
export function PageHeader({
  title,
  help,
  lead,
  actions,
}: {
  title: string;
  /** A help button (`HelpTip`), read with the title. */
  help?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className={textRole.pageTitle}>
          {title}
          {help}
        </h2>
        {lead !== undefined && <p className={`mt-1 ${textRole.pageLead}`}>{lead}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
