/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the GameChanger proxy answers, when it is not the Vercel function (`gcProxyEndpoint`). */
  readonly VITE_GC_PROXY_URL?: string;
}
