/**
 * @cullit/pro — Premium features for Cullit.
 *
 * Importing this module registers all pro plugins with @cullit/core:
 *   - AI generators (Anthropic, OpenAI, Gemini, Ollama)
 *   - Jira/Linear collectors and enrichers
 *   - Slack, Discord, GitHub Release publishers
 *
 * Usage (in CLI or consumer code):
 *   await import('@cullit/pro');  // auto-registers everything
 */

import {
  AI_PROVIDERS,
  registerCollector,
  registerEnricher,
  registerGenerator,
  registerPublisher,
} from '@cullit/core';
import type { CullConfig, PublishTarget } from '@cullit/core';

import { AIGenerator } from './generators/ai';
import { JiraCollector } from './collectors/jira';
import { LinearCollector } from './collectors/linear';
import { JiraEnricher } from './enrichers/jira';
import { LinearEnricher } from './enrichers/linear';
import { SlackPublisher } from './publishers/slack';
import { DiscordPublisher } from './publishers/discord';
import { GitHubReleasePublisher } from './publishers/github-release';
import { TeamsPublisher } from './publishers/teams';
import { ConfluencePublisher } from './publishers/confluence';
import { NotionPublisher } from './publishers/notion';
import { GitLabReleasePublisher } from './publishers/gitlab-release';
import { ChangelogPublisher } from './publishers/changelog';
import { GitLabCollector } from './collectors/gitlab';
import { BitbucketCollector } from './collectors/bitbucket';

// --- Register pro AI generators for each provider (except 'none' which uses core's template generator) ---
for (const provider of AI_PROVIDERS) {
  if (provider === 'none') continue;
  registerGenerator(provider, () => new AIGenerator());
}

// --- Register pro collectors (uniform: factory(config: CullConfig)) ---
registerCollector('jira', (config: CullConfig) => {
  if (!config.jira) throw new Error('Jira source requires jira config in .cullit.yml');
  return new JiraCollector(config.jira);
});
registerCollector('linear', (config: CullConfig) => new LinearCollector(config.linear?.apiKey));
registerCollector('gitlab', (config: CullConfig) => {
  if (!config.gitlab) throw new Error('GitLab source requires gitlab config in .cullit.yml');
  return new GitLabCollector(config.gitlab);
});
registerCollector('bitbucket', (config: CullConfig) => {
  if (!config.bitbucket) throw new Error('Bitbucket source requires bitbucket config in .cullit.yml');
  return new BitbucketCollector(config.bitbucket);
});

// --- Register pro enrichers (uniform: factory(config: CullConfig)) ---
registerEnricher('jira', (config: CullConfig) => {
  if (!config.jira) throw new Error('Jira enrichment requires jira config in .cullit.yml');
  return new JiraEnricher(config.jira);
});
registerEnricher('linear', (config: CullConfig) => new LinearEnricher(config.linear?.apiKey));

// --- Register pro publishers (uniform: factory(target: PublishTarget)) ---
registerPublisher('slack', (target: PublishTarget) => {
  if (!target.webhookUrl) throw new Error('Slack publisher requires "webhookUrl" in config.');
  return new SlackPublisher(target.webhookUrl);
});
registerPublisher('discord', (target: PublishTarget) => {
  if (!target.webhookUrl) throw new Error('Discord publisher requires "webhookUrl" in config.');
  return new DiscordPublisher(target.webhookUrl);
});
registerPublisher('github-release', (_target: PublishTarget) => new GitHubReleasePublisher());
registerPublisher('teams', (target: PublishTarget) => {
  if (!target.webhookUrl) throw new Error('Teams publisher requires "webhookUrl" in config.');
  return new TeamsPublisher(target.webhookUrl);
});
registerPublisher('confluence', (target: PublishTarget) => new ConfluencePublisher(target as unknown as ConstructorParameters<typeof ConfluencePublisher>[0]));
registerPublisher('notion', (target: PublishTarget) => new NotionPublisher(target as unknown as ConstructorParameters<typeof NotionPublisher>[0]));
registerPublisher('gitlab-release', (_target: PublishTarget) => new GitLabReleasePublisher());
registerPublisher('changelog', (target: PublishTarget) => new ChangelogPublisher(target as unknown as ConstructorParameters<typeof ChangelogPublisher>[0]));

// Re-export classes for direct usage
export { AIGenerator } from './generators/ai';
export { JiraCollector } from './collectors/jira';
export { LinearCollector } from './collectors/linear';
export { JiraEnricher } from './enrichers/jira';
export { LinearEnricher } from './enrichers/linear';
export { SlackPublisher } from './publishers/slack';
export { DiscordPublisher } from './publishers/discord';
export { GitHubReleasePublisher } from './publishers/github-release';
export { TeamsPublisher } from './publishers/teams';
export { ConfluencePublisher } from './publishers/confluence';
export { NotionPublisher } from './publishers/notion';
export { GitLabReleasePublisher } from './publishers/gitlab-release';
export { ChangelogPublisher } from './publishers/changelog';
export { GitLabCollector } from './collectors/gitlab';
export { BitbucketCollector } from './collectors/bitbucket';
