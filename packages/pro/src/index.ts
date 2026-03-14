/**
 * @cullit/pro — Premium features for Cullit.
 *
 * Importing this module registers all pro plugins with @cullit/core:
 *   - AI generators (Anthropic, OpenAI, Gemini, Ollama, OpenClaw)
 *   - Jira/Linear collectors and enrichers
 *   - Slack, Discord, GitHub Release publishers
 *
 * Usage (in CLI or consumer code):
 *   await import('@cullit/pro');  // auto-registers everything
 */

import {
  registerCollector,
  registerEnricher,
  registerGenerator,
  registerPublisher,
} from '@cullit/core';

import { AIGenerator } from './generators/ai';
import { JiraCollector } from './collectors/jira';
import { LinearCollector } from './collectors/linear';
import { JiraEnricher } from './enrichers/jira';
import { LinearEnricher } from './enrichers/linear';
import { SlackPublisher } from './publishers/slack';
import { DiscordPublisher } from './publishers/discord';
import { GitHubReleasePublisher } from './publishers/github-release';

// --- Register pro generators ---
const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama', 'openclaw'] as const;
for (const provider of AI_PROVIDERS) {
  registerGenerator(provider, (openclawConfig?: any) => new AIGenerator(openclawConfig));
}

// --- Register pro collectors ---
registerCollector('jira', (config: any) => new JiraCollector(config));
registerCollector('linear', (apiKey?: string) => new LinearCollector(apiKey));

// --- Register pro enrichers ---
registerEnricher('jira', (config: any) => new JiraEnricher(config));
registerEnricher('linear', (apiKey?: string) => new LinearEnricher(apiKey));

// --- Register pro publishers ---
registerPublisher('slack', (webhookUrl: string) => new SlackPublisher(webhookUrl));
registerPublisher('discord', (webhookUrl: string) => new DiscordPublisher(webhookUrl));
registerPublisher('github-release', () => new GitHubReleasePublisher());

// Re-export classes for direct usage
export { AIGenerator } from './generators/ai';
export { JiraCollector } from './collectors/jira';
export { LinearCollector } from './collectors/linear';
export { JiraEnricher } from './enrichers/jira';
export { LinearEnricher } from './enrichers/linear';
export { SlackPublisher } from './publishers/slack';
export { DiscordPublisher } from './publishers/discord';
export { GitHubReleasePublisher } from './publishers/github-release';
