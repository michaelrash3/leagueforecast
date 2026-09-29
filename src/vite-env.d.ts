/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the GameChanger proxy answers, when it is not the Vercel function (`gcProxyEndpoint`). */
  readonly VITE_GC_PROXY_URL?: string;
  /** The Firebase web app's settings, for keeping this browser's data in the cloud (`cloudConfig`). */
  readonly VITE_FIREBASE_CONFIG?: string;
  /**
   * Where a Firestore emulator answers (`host:port`). Set by `npm run test:rules` for the rules
   * test alone; a build never carries it, since Vite passes on only what starts `VITE_`.
   */
  readonly FIRESTORE_EMULATOR_HOST?: string;
}
