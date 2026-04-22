/**
 * Process metrics for the Cullit GitHub App webhook server.
 */
export const metrics = {
  webhooksReceived: 0,
  releasesProcessed: 0,
  pushesProcessed: 0,
  installations: 0,
  errors: 0,
  startedAt: Date.now(),
};
