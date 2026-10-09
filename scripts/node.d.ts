/**
 * The sliver of Node this directory's scripts use.
 *
 * Written out rather than pulled in with `@types/node`, for the reason `api/gc-team.ts` and
 * `verify-gc-pull.ts` already give: that package replaces the global timer typings, and the
 * browser project shares this compiler. Three lines here cost less than `setTimeout` returning a
 * `Timeout` everywhere in the app.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
}

declare module "node:crypto" {
  type Sign = { update: (data: string) => Sign; sign: (key: string, encoding: "base64") => string };
  export function createSign(algorithm: string): Sign;
}

declare module "node:zlib" {
  export function gzipSync(data: string): Uint8Array;
}
