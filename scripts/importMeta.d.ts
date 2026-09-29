/**
 * What the Node side of the type check knows of `import.meta.env`, which only Vite provides.
 *
 * `gameChangerClient.ts` reads the proxy setting there (`gcProxyEndpoint`), and the scripts reach
 * that module through `teamRankingsStorage.ts`, so this project type-checks it too. At run time a
 * script has no such object, and the read is wrapped in a catch for exactly that. `vite.config.ts`
 * reaches `cloudConfig.ts` the same way, through the page's content policy, and is checked with
 * this file for the same reason.
 */
interface ImportMeta {
  readonly env: { readonly VITE_GC_PROXY_URL?: string; readonly VITE_FIREBASE_CONFIG?: string };
}
