export type { 
  CullConfig, AIConfig, GitDiff, GitCommit,
  ReleaseNotes, ChangeEntry, ChangeCategory,
  EnrichedTicket, EnrichedContext,
  Collector, Enricher, Generator, Publisher,
  PipelineResult, OutputFormat, PublishTarget,
  OpenClawConfig, AIProvider, Audience, Tone,
  SourceConfig, PublisherType, EnrichmentType,
  JiraConfig, LinearConfig,
} from './types';
export { VERSION, DEFAULT_CATEGORIES, DEFAULT_MODELS } from './constants';
export { createLogger } from './logger';
export type { Logger, LogLevel } from './logger';
import { DEFAULT_MODELS } from './constants';
import { createLogger, type Logger } from './logger';

export { GitCollector, getRecentTags, getLatestTag } from './collectors/git';
export { JiraCollector } from './collectors/jira';
export { LinearCollector } from './collectors/linear';
export { AIGenerator } from './generators/ai';
export { TemplateGenerator } from './generators/template';
export { formatNotes } from './formatter';
export { StdoutPublisher, FilePublisher, SlackPublisher, DiscordPublisher, GitHubReleasePublisher } from './publishers/index';
export { JiraEnricher } from './enrichers/jira';
export { LinearEnricher } from './enrichers/linear';
export { analyzeReleaseReadiness } from './advisor';
export type { ReleaseAdvisory, SemverBump } from './advisor';

import type { CullConfig, EnrichedContext, PipelineResult, OutputFormat, EnrichedTicket } from './types';
import { GitCollector } from './collectors/git';
import { JiraCollector } from './collectors/jira';
import { LinearCollector } from './collectors/linear';
import { AIGenerator } from './generators/ai';
import { TemplateGenerator } from './generators/template';
import { formatNotes } from './formatter';
import { StdoutPublisher, FilePublisher, SlackPublisher, DiscordPublisher, GitHubReleasePublisher } from './publishers/index';
import { JiraEnricher } from './enrichers/jira';
import { LinearEnricher } from './enrichers/linear';

/**
 * Main pipeline: Collect → Enrich → Generate → Format → Publish
 */
export async function runPipeline(
  from: string,
  to: string,
  config: CullConfig,
  options: { format?: OutputFormat; dryRun?: boolean; logger?: Logger } = {}
): Promise<PipelineResult> {
  const startTime = Date.now();
  const format = options.format || 'markdown';
  const log = options.logger || createLogger('normal');

  // 1. COLLECT
  let collector;
  if (config.source.type === 'jira') {
    if (!config.jira) throw new Error('Jira source requires jira config in .cullit.yml');
    log.info(`» Collecting issues from Jira...`);
    collector = new JiraCollector(config.jira);
  } else if (config.source.type === 'linear') {
    log.info(`» Collecting issues from Linear...`);
    collector = new LinearCollector(config.linear?.apiKey);
  } else {
    log.info(`» Collecting commits between ${from}..${to}`);
    collector = new GitCollector();
  }
  const diff = await collector.collect(from, to);
  const itemLabel = config.source.type === 'jira' || config.source.type === 'linear' ? 'issues' : 'commits';
  log.info(`» Found ${diff.commits.length} ${itemLabel}${diff.filesChanged ? `, ${diff.filesChanged} files changed` : ''}`);

  if (diff.commits.length === 0) {
    const source = config.source.type === 'jira' ? 'Jira' : config.source.type === 'linear' ? 'Linear' : `${from} and ${to}`;
    throw new Error(`No ${itemLabel} found from ${source}`);
  }

  // 2. ENRICH
  const tickets: EnrichedTicket[] = [];
  const enrichmentSources = config.source.enrichment || [];

  for (const source of enrichmentSources) {
    if (source === 'jira' && config.jira) {
      log.info('» Enriching from Jira...');
      const enricher = new JiraEnricher(config.jira);
      const jiraTickets = await enricher.enrich(diff);
      tickets.push(...jiraTickets);
      log.info(`» Jira: found ${jiraTickets.length} tickets`);
    }

    if (source === 'linear') {
      log.info('» Enriching from Linear...');
      const enricher = new LinearEnricher(config.linear?.apiKey);
      const linearTickets = await enricher.enrich(diff);
      tickets.push(...linearTickets);
      log.info(`» Linear: found ${linearTickets.length} issues`);
    }
  }

  const context: EnrichedContext = { diff, tickets };

  // 3. GENERATE
  const providerNames: Record<string, string> = {
    anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama', openclaw: 'OpenClaw', none: 'Template',
  };

  const providerName = providerNames[config.ai.provider] || config.ai.provider;
  const modelName = config.ai.provider === 'none' ? 'template' : (config.ai.model || DEFAULT_MODELS[config.ai.provider] || 'default');
  log.info(`» Generating with ${providerName} (${modelName})...`);

  let notes;
  if (config.ai.provider === 'none') {
    const generator = new TemplateGenerator();
    notes = await generator.generate(context, config.ai);
  } else {
    const generator = new AIGenerator(config.openclaw);
    notes = await generator.generate(context, config.ai);
  }
  log.info(`» Generated ${notes.changes.length} change entries`);

  // 4. FORMAT
  const formatted = formatNotes(notes, format);

  // 5. PUBLISH
  const publishedTo: string[] = [];

  if (!options.dryRun) {
    for (const target of config.publish) {
      try {
        switch (target.type) {
          case 'stdout':
            await new StdoutPublisher().publish(notes, format);
            publishedTo.push('stdout');
            break;
          case 'file':
            if (target.path) {
              await new FilePublisher(target.path).publish(notes, format);
              publishedTo.push(`file:${target.path}`);
            }
            break;
          case 'slack':
            if (target.webhookUrl) {
              await new SlackPublisher(target.webhookUrl).publish(notes, format);
              publishedTo.push('slack');
            }
            break;
          case 'discord':
            if (target.webhookUrl) {
              await new DiscordPublisher(target.webhookUrl).publish(notes, format);
              publishedTo.push('discord');
            }
            break;
          case 'github-release':
            await new GitHubReleasePublisher().publish(notes, format);
            publishedTo.push('github-release');
            break;
        }
      } catch (err) {
        log.error(`✗ Failed to publish to ${target.type}: ${(err as Error).message}`);
      }
    }
  } else {
    log.info('\n[DRY RUN — Not publishing]\n');
    log.info(formatted);
    publishedTo.push('dry-run');
  }

  const duration = Date.now() - startTime;
  log.info(`\n✓ Done in ${(duration / 1000).toFixed(1)}s`);

  return { notes, formatted, publishedTo, duration };
}
