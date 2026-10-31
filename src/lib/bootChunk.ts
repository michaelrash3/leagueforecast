/**
 * Which modules go in the build's one boot chunk (`vite.config.ts`): the plain logic modules the
 * page loads at start. The bundler had cut the first download's logic into the entry chunk and 23
 * files of 55 modules it shares with views loaded later, each fetched at start anyway; gzip
 * started each file afresh, and each carried its own imports and exports. With all of it in one
 * file, the first download measured 247,951 bytes gzipped against 254.9 KB before (30 Oct 2026),
 * with nothing removed and nothing fetched later. Components stay in the entry chunk: a chunk
 * takes the modules its own import along, so a component in the boot chunk brought React's core
 * with it, out of React's own chunk, which then changed with every release.
 *
 * The cost is in caching: a release that changes any logic module has a returning visitor fetch
 * the whole file again (about 124 KB), where before it fetched the entry chunk and the one small
 * shared file that changed. The first download is the page's tightest budget, so the bytes are
 * worth more than the cache.
 */

/** What the bundler knows of a module, as much of it as this reads. */
export type ModuleLinks = {
  isEntry: boolean;
  /** The modules that import this one statically; one imported on demand loads later. */
  importers: readonly string[];
};

/**
 * A test of whether a module is loaded at start, for one build's module graph: whether a chain of
 * static imports leads to it from the page's entry, found by walking its static importers up the
 * graph. Answers are kept, since the bundler asks for every module.
 */
export const loadedAtStartTest = (linksOf: (id: string) => ModuleLinks | null) => {
  const known = new Map<string, boolean>();
  return (id: string): boolean => {
    const kept = known.get(id);
    if (kept !== undefined) return kept;
    let atStart = false;
    const seen = new Set<string>([id]);
    const queue = [id];
    for (let next = queue.pop(); next !== undefined && !atStart; next = queue.pop()) {
      const links = linksOf(next);
      if (!links) continue;
      atStart = links.isEntry || known.get(next) === true;
      for (const importer of links.importers) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        queue.push(importer);
      }
    }
    known.set(id, atStart);
    return atStart;
  };
};
