/**
 * Structured error codes for the Cullit core pipeline.
 * Used in CullitError instances so callers can branch on code rather than message parsing.
 */

export const CoreErrorCode = {
  // Git / Source
  GIT_REF_INVALID: 'GIT_REF_INVALID',
  GIT_LOG_FAILED: 'GIT_LOG_FAILED',

  // Multi-repo
  MULTI_REPO_EMPTY: 'MULTI_REPO_EMPTY',
  MULTI_REPO_MISSING_TARGET: 'MULTI_REPO_MISSING_TARGET',
  MULTI_REPO_INVALID_URL: 'MULTI_REPO_INVALID_URL',

  // Pipeline
  PIPELINE_NO_CHANGES: 'PIPELINE_NO_CHANGES',
  PIPELINE_COLLECTOR_MISSING: 'PIPELINE_COLLECTOR_MISSING',
  PIPELINE_GENERATOR_MISSING: 'PIPELINE_GENERATOR_MISSING',

  // License
  LICENSE_INVALID: 'LICENSE_INVALID',
  LICENSE_TIER_INSUFFICIENT: 'LICENSE_TIER_INSUFFICIENT',

  // Fetch
  FETCH_TIMEOUT: 'FETCH_TIMEOUT',

  // Publisher
  PUBLISHER_PATH_TRAVERSAL: 'PUBLISHER_PATH_TRAVERSAL',
} as const;

export type CoreErrorCodeValue = typeof CoreErrorCode[keyof typeof CoreErrorCode];

/**
 * Error class carrying a structured code alongside the human-readable message.
 */
export class CullitError extends Error {
  readonly code: CoreErrorCodeValue;

  constructor(code: CoreErrorCodeValue, message: string) {
    super(message);
    this.name = 'CullitError';
    this.code = code;
  }
}
