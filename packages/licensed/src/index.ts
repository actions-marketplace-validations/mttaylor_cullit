#!/usr/bin/env node

// Private paid distribution: preload paid plugin registrations, then run CLI.
await import('@cullit/pro');
await import('cullit');
