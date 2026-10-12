/**
 * `work`, remembering its last answer: asked again with the very same arguments, it gives that
 * answer back rather than working it out again (2.2).
 *
 * For a calculation only one tab shows, worked out only while that tab is open. A `useMemo` would
 * forget it the moment the tab closed, since whether the tab is open is one of the things it is
 * keyed on, and so going back to a tab whose season had not changed would work it all out again;
 * kept here, keyed on the inputs alone, it costs nothing. One answer, not a cache of them: the
 * season moves forward, and an answer for a season no longer open is of no use.
 *
 * Arguments are compared by identity, as the season's parts keep theirs until they change.
 */
export const rememberLast = <A extends readonly unknown[], R>(
  work: (...args: A) => R
): ((...args: A) => R) => {
  let last: { args: A; answer: R } | null = null;
  return (...args: A): R => {
    if (
      last &&
      last.args.length === args.length &&
      last.args.every((arg, index) => Object.is(arg, args[index]))
    ) {
      return last.answer;
    }
    const answer = work(...args);
    last = { args, answer };
    return answer;
  };
};
