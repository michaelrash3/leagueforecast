let resolver: (() => Promise<string | null>) | null = null;

/** Registered by the lazily loaded Firebase client; no token is persisted or logged. */
export const registerSummaryToken = (next: () => Promise<string | null>): void => {
  resolver = next;
};

export const summaryToken = (): Promise<string | null> =>
  resolver ? resolver() : Promise.resolve(null);
