/**
 * The shape of a value a device reads from the server, said once as data and checked in one walk
 * (`fits`): what a larger answer must be before a card draws it, field by field, rather than taken
 * on trust. A field the shape does not name is let through, so a newer server may say more than
 * this build reads; one it names is of its kind, or the answer is refused whole.
 */
export type Shape =
  | "string"
  /** A string with something in it: an id. */
  | "id"
  | "number"
  /** A whole number, none or more. */
  | "count"
  | "boolean"
  | { optional: Shape }
  | { nullable: Shape }
  | { list: Shape }
  | { record: { readonly [field: string]: Shape } }
  /** A record of any keys, each value of one shape. */
  | { dictionary: Shape }
  | { oneOf: readonly string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether `value` is of `shape`. */
export const fits = (value: unknown, shape: Shape): boolean => {
  if (shape === "string") return typeof value === "string";
  if (shape === "id") return typeof value === "string" && value !== "";
  if (shape === "number") return typeof value === "number" && Number.isFinite(value);
  if (shape === "count")
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (shape === "boolean") return typeof value === "boolean";
  if ("optional" in shape) return value === undefined || fits(value, shape.optional);
  if ("nullable" in shape) return value === null || fits(value, shape.nullable);
  if ("list" in shape) return Array.isArray(value) && value.every((item) => fits(item, shape.list));
  if ("oneOf" in shape) return typeof value === "string" && shape.oneOf.includes(value);
  if (!isRecord(value)) return false;
  if ("dictionary" in shape)
    return Object.values(value).every((item) => fits(item, shape.dictionary));
  return Object.entries(shape.record).every(([field, of]) =>
    fits(Object.prototype.hasOwnProperty.call(value, field) ? value[field] : undefined, of)
  );
};
