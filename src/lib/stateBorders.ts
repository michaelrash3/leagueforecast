/**
 * Which states share a border, for asking whether two clubs could meet on an ordinary weekend.
 *
 * Youth baseball is played regionally. A club's opponents are its neighbours, and state lines do
 * not fence a region in: Cincinnati's clubs play Northern Kentucky and south-east Indiana every
 * week, Kansas City is two states, and so are St. Louis, Louisville, Philadelphia and Omaha. The
 * pool used to ask "same state?" wherever it needed to know whether two clubs were near each other,
 * and that answered no for the club across the river while answering yes for the one three hundred
 * miles away at the other end of Texas. A border is the smallest widening that takes in the
 * river crossings without taking in the country.
 *
 * Kept as pairs rather than as a list per state so that it cannot be one-sided: every pair is read
 * both ways round. Land borders only — Michigan and Minnesota meet in Lake Superior, which nobody
 * drives across for a game — with the two Four Corners diagonals (Arizona–Colorado,
 * New Mexico–Utah) kept, since the corner is a road junction. The District of Columbia is in, as
 * the neighbour of Maryland and Virginia it is. Alaska and Hawaii border nobody.
 */
const BORDERS: readonly (readonly [string, string])[] = [
  ["AL", "FL"],
  ["AL", "GA"],
  ["AL", "MS"],
  ["AL", "TN"],
  ["AR", "LA"],
  ["AR", "MO"],
  ["AR", "MS"],
  ["AR", "OK"],
  ["AR", "TN"],
  ["AR", "TX"],
  ["AZ", "CA"],
  ["AZ", "CO"],
  ["AZ", "NM"],
  ["AZ", "NV"],
  ["AZ", "UT"],
  ["CA", "NV"],
  ["CA", "OR"],
  ["CO", "KS"],
  ["CO", "NE"],
  ["CO", "NM"],
  ["CO", "OK"],
  ["CO", "UT"],
  ["CO", "WY"],
  ["CT", "MA"],
  ["CT", "NY"],
  ["CT", "RI"],
  ["DC", "MD"],
  ["DC", "VA"],
  ["DE", "MD"],
  ["DE", "NJ"],
  ["DE", "PA"],
  ["FL", "GA"],
  ["GA", "NC"],
  ["GA", "SC"],
  ["GA", "TN"],
  ["IA", "IL"],
  ["IA", "MN"],
  ["IA", "MO"],
  ["IA", "NE"],
  ["IA", "SD"],
  ["IA", "WI"],
  ["ID", "MT"],
  ["ID", "NV"],
  ["ID", "OR"],
  ["ID", "UT"],
  ["ID", "WA"],
  ["ID", "WY"],
  ["IL", "IN"],
  ["IL", "KY"],
  ["IL", "MO"],
  ["IL", "WI"],
  ["IN", "KY"],
  ["IN", "MI"],
  ["IN", "OH"],
  ["KS", "MO"],
  ["KS", "NE"],
  ["KS", "OK"],
  ["KY", "MO"],
  ["KY", "OH"],
  ["KY", "TN"],
  ["KY", "VA"],
  ["KY", "WV"],
  ["LA", "MS"],
  ["LA", "TX"],
  ["MA", "NH"],
  ["MA", "NY"],
  ["MA", "RI"],
  ["MA", "VT"],
  ["MD", "PA"],
  ["MD", "VA"],
  ["MD", "WV"],
  ["ME", "NH"],
  ["MI", "OH"],
  ["MI", "WI"],
  ["MN", "ND"],
  ["MN", "SD"],
  ["MN", "WI"],
  ["MO", "NE"],
  ["MO", "OK"],
  ["MO", "TN"],
  ["MS", "TN"],
  ["MT", "ND"],
  ["MT", "SD"],
  ["MT", "WY"],
  ["NC", "SC"],
  ["NC", "TN"],
  ["NC", "VA"],
  ["ND", "SD"],
  ["NE", "SD"],
  ["NE", "WY"],
  ["NH", "VT"],
  ["NJ", "NY"],
  ["NJ", "PA"],
  ["NM", "OK"],
  ["NM", "TX"],
  ["NM", "UT"],
  ["NV", "OR"],
  ["NV", "UT"],
  ["NY", "PA"],
  ["NY", "VT"],
  ["OH", "PA"],
  ["OH", "WV"],
  ["OK", "TX"],
  ["OR", "WA"],
  ["PA", "WV"],
  ["SD", "WY"],
  ["TN", "VA"],
  ["UT", "WY"],
  ["VA", "WV"],
];

const NEIGHBOURS = new Map<string, Set<string>>();
const link = (from: string, to: string) => {
  const bucket = NEIGHBOURS.get(from);
  if (bucket) bucket.add(to);
  else NEIGHBOURS.set(from, new Set([to]));
};
BORDERS.forEach(([a, b]) => {
  link(a, b);
  link(b, a);
});

/** Every state that shares a land border with this one, as two-letter codes. */
export const borderingStates = (state: string): ReadonlySet<string> =>
  NEIGHBOURS.get(state) ?? new Set<string>();

/**
 * Whether two clubs are close enough to be each other's ordinary opponents: the same state or two
 * that share a border. A state nobody knows is not a disagreement — nothing says it is far — so
 * either side missing is a yes, which is the rule `stateFits` already keeps for the same question.
 */
export const inOneRegion = (a: string | undefined, b: string | undefined): boolean =>
  !a || !b || a === b || (NEIGHBOURS.get(a)?.has(b) ?? false);
