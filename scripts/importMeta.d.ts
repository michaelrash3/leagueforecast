/**
 * What the Node side of the type check knows of `import.meta.env`, which only Vite provides.
 *
 * `gameChangerClient.ts` reads the proxy setting there (`gcProxyEndpoint`), and the scripts reach
 * that module through `teamRankingsStorage.ts`, so this project type-checks it too. At run time a
 * script has no such object, and the read is wrapped in a catch for exactly that.
 */
interface ImportMeta {
  readonly env: { readonly VITE_GC_PROXY_URL?: string };
}
