/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the GameChanger proxy answers, when it is not the Vercel function (`gcProxyEndpoint`). */
  readonly VITE_GC_PROXY_URL?: string;
  /**
   * Where a Firestore emulator answers (`host:port`). Set by `npm run test:rules` for the rules
   * test alone; a build never carries it, since Vite passes on only what starts `VITE_`.
   */
  readonly FIRESTORE_EMULATOR_HOST?: string;
}
