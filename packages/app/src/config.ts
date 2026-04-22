/**
 * Environment configuration for the Cullit GitHub App.
 * Centralized so handlers / github-api / server modules share the same values.
 */
import { decodeKey } from './util.js';

export const APP_ID = process.env['GITHUB_APP_ID'] || '';
export const PRIVATE_KEY = decodeKey(process.env['GITHUB_APP_PRIVATE_KEY'] || '');
export const WEBHOOK_SECRET = process.env['GITHUB_WEBHOOK_SECRET'] || '';
export const PORT = parseInt(process.env['CULLIT_APP_PORT'] || '3001', 10);
export const RATE_LIMIT = parseInt(process.env['CULLIT_APP_RATE_LIMIT'] || '60', 10);
export const RATE_WINDOW = 60_000;

// AI provider config (requires @cullit/pro)
export const AI_PROVIDER = process.env['CULLIT_AI_PROVIDER'] || 'none';
export const AI_MODEL = process.env['CULLIT_AI_MODEL'] || undefined;
export const AI_API_KEY = process.env['CULLIT_AI_API_KEY'] || undefined;

// Auto-publish targets
export const SLACK_WEBHOOK = process.env['CULLIT_APP_SLACK_WEBHOOK'] || '';
export const DISCORD_WEBHOOK = process.env['CULLIT_APP_DISCORD_WEBHOOK'] || '';
export const TEAMS_WEBHOOK = process.env['CULLIT_APP_TEAMS_WEBHOOK'] || '';
export const CHANGELOG_ENABLED = process.env['CULLIT_APP_CHANGELOG_ENABLED'] === 'true';

// API auto-link
export const CULLIT_API_URL = process.env['CULLIT_API_URL'] || '';
export const CULLIT_APP_SECRET = process.env['CULLIT_APP_SECRET'] || '';
