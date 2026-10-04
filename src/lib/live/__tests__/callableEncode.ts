/**
 * How a callable's result is sent, as firebase-functions 7.4.0 writes it (`encode` in
 * `lib/common/providers/https.js`): a field left undefined goes as null, and a number with no end
 * throws. `functions/smoke.mjs` holds the installed SDK's own `encode` to the same three behaviours,
 * so a test written against this one fails where the SDK would.
 */
export const callableEncode = (data: unknown): unknown => {
  if (data === null || data === undefined) return null;
  if (typeof data === "number") {
    if (Number.isFinite(data)) return data;
    throw new Error(`Data cannot be encoded in JSON: ${data}`);
  }
  if (typeof data === "boolean" || typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(callableEncode);
  if (typeof data === "object")
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, callableEncode(value)])
    );
  throw new Error(`Data cannot be encoded in JSON: ${String(data)}`);
};
