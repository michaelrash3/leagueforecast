/**
 * An upload's id as `randomId` makes one: 128 bits, hex. Kept apart from `uploads.ts`, which packs
 * and reads uploads, so the commands that name one (`commands.ts`) carry none of that code.
 */
export const isUploadId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
