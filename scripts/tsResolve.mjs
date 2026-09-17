/**
 * Lets Node run the TypeScript under `src/` without a bundler.
 *
 * The app's own modules import each other the way Vite expects — `./csv`, no extension — which is
 * not a path Node will resolve, so a script that reaches into `src/lib` dies on the first import
 * even with `--experimental-strip-types` doing the rest. This hook fills in the extension Vite
 * would have, and nothing else: anything that already carries one, and every bare package
 * specifier, goes straight through untouched.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];
const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/i;

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (relative && context.parentURL && !HAS_EXTENSION.test(specifier)) {
    const base = new URL(specifier, context.parentURL).href;
    for (const suffix of SUFFIXES) {
      const candidate = `${base}${suffix}`;
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate, context);
    }
  }
  return nextResolve(specifier, context);
}
