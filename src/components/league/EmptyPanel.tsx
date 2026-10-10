import { StatePanel } from "../StatePanel";

/**
 * A panel standing in for one that has nothing to show yet, saying what would fill it.
 */
export function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <StatePanel kind="empty" heading={3} title={title}>
      <p>{body}</p>
    </StatePanel>
  );
}
