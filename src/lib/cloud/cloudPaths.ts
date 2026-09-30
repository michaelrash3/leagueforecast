/** Firestore paths for one authenticated owner's copy. */
export const ownerRoot = (uid: string): string => `users/${encodeURIComponent(uid)}`;

export const manifestPath = (uid: string): string => `${ownerRoot(uid)}/copies/main`;
export const chunksPath = (uid: string): string => `${manifestPath(uid)}/chunks`;
export const jobPath = (uid: string, jobId: string): string =>
  `${manifestPath(uid)}/jobs/${encodeURIComponent(jobId)}`;
export const jobPiecePath = (uid: string, jobId: string, index: number): string =>
  `${jobPath(uid, jobId)}/pieces/${index}`;
