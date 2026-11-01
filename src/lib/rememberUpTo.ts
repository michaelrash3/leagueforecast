/**
 * `work`, remembering its answer for each key it is asked about, up to `most` keys: asked about one
 * it holds, it gives that answer back rather than working it out again, and once it holds `most` it
 * lets go of them all and starts again.
 *
 * For a pure calculation asked about the same keys over and over, as cleaning a team's name is by
 * every pass that compares names. All at once rather than the oldest first, because what a pass
 * asks about comes round within the pass, and an order to let go in would be a second list as long
 * as the first; the bound is what keeps a page, a worker or a server that runs for days from
 * holding every name it was ever shown.
 */
export const rememberUpTo = (
  most: number,
  work: (key: string) => string
): ((key: string) => string) => {
  const held = new Map<string, string>();
  return (key) => {
    const known = held.get(key);
    if (known !== undefined) return known;
    if (held.size >= most) held.clear();
    const made = work(key);
    held.set(key, made);
    return made;
  };
};
