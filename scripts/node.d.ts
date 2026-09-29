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
}
