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
export { TemplateGenerator } from './generators/template';
export { formatNotes } from './formatter';
export { StdoutPublisher, FilePublisher } from './publishers/index';
export { analyzeReleaseReadiness } from './advisor';
export type { ReleaseAdvisory, SemverBump } from './advisor';
export { resolveLicense, isProviderAllowed, isPublisherAllowed, isEnrichmentAllowed, upgradeMessage } from './gate';
export type { LicenseTier, LicenseStatus } from './gate';
export {
  registerCollector, registerEnricher, registerGenerator, registerPublisher,
  getCollector, getEnricher, getGenerator, getPublisher,
  hasCollector, hasEnricher, hasGenerator, hasPublisher,
} from './registry';
export type { CollectorFactory, EnricherFactory, GeneratorFactory, PublisherFactory } from './registry';
export { fetchWithTimeout } from './fetch';

import type { CullConfig, EnrichedContext, PipelineResult, OutputFormat, EnrichedTicket } from './types';
import { resolveLicense, isProviderAllowed, isPublisherAllowed, isEnrichmentAllowed, upgradeMessage } from './gate';
import { GitCollector } from './collectors/git';
import { TemplateGenerator } from './generators/template';
import { formatNotes } from './formatter';
import { StdoutPublisher, FilePublisher } from './publishers/index';
import {
  registerCollector, registerGenerator, registerPublisher,
  getCollector, getEnricher, getGenerator, getPublisher,
} from './registry';

// --- Register free (core) plugins ---
registerCollector('local', () => new GitCollector());
registerGenerator('none', () => new TemplateGenerator());
registerPublisher('stdout', () => new StdoutPublisher());
registerPublisher('file', (path: string) => new FilePublisher(path));

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

  // LICENSE CHECK
  const license = resolveLicense();

  if (!license.valid) {
    throw new Error(license.message || 'Invalid CULLIT_API_KEY');
  }

  if (!isProviderAllowed(config.ai.provider, license)) {
    throw new Error(upgradeMessage(`AI provider "${config.ai.provider}"`));
  }

  // 1. COLLECT
  const collectorFactory = getCollector(config.source.type);
  if (!collectorFactory) {
    throw new Error(
      `Source type "${config.source.type}" is not available. ` +
      (config.source.type === 'jira' || config.source.type === 'linear'
        ? 'Install @cullit/pro to use this source.'
        : 'Valid sources: local')
    );
  }

  const sourceLabel = config.source.type === 'jira' ? 'issues from Jira'
    : config.source.type === 'linear' ? 'issues from Linear'
    : `commits between ${from}..${to}`;
  log.info(`» Collecting ${sourceLabel}`);

  let collector;
  if (config.source.type === 'jira') {
    if (!config.jira) throw new Error('Jira source requires jira config in .cullit.yml');
    collector = collectorFactory(config.jira);
  } else if (config.source.type === 'linear') {
    collector = collectorFactory(config.linear?.apiKey);
  } else {
    collector = collectorFactory();
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
    if (!isEnrichmentAllowed(license)) {
      log.info(`» Skipping ${source} enrichment — ${upgradeMessage(`${source} enrichment`)}`);
      continue;
    }

    const enricherFactory = getEnricher(source);
    if (!enricherFactory) {
      log.info(`» Skipping ${source} enrichment — install @cullit/pro to enable`);
      continue;
    }

    log.info(`» Enriching from ${source}...`);
    let enricher;
    if (source === 'jira' && config.jira) {
      enricher = enricherFactory(config.jira);
    } else if (source === 'linear') {
      enricher = enricherFactory(config.linear?.apiKey);
    } else {
      continue;
    }

    const enrichedTickets = await enricher.enrich(diff);
    tickets.push(...enrichedTickets);
    log.info(`» ${source}: found ${enrichedTickets.length} ${source === 'jira' ? 'tickets' : 'issues'}`);
  }

  const context: EnrichedContext = { diff, tickets };

  // 3. GENERATE
  const providerNames: Record<string, string> = {
    anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama', openclaw: 'OpenClaw', none: 'Template',
  };

  const providerName = providerNames[config.ai.provider] || config.ai.provider;
  const modelName = config.ai.provider === 'none' ? 'template' : (config.ai.model || DEFAULT_MODELS[config.ai.provider] || 'default');
  log.info(`» Generating with ${providerName} (${modelName})...`);

  const generatorFactory = getGenerator(config.ai.provider);
  if (!generatorFactory) {
    throw new Error(
      `AI provider "${config.ai.provider}" is not available. ` +
      (config.ai.provider !== 'none'
        ? 'Install @cullit/pro to use AI providers.'
        : '')
    );
  }

  let generator;
  if (config.ai.provider === 'none') {
    generator = generatorFactory();
  } else {
    generator = generatorFactory(config.openclaw);
  }

  const notes = await generator.generate(context, config.ai);
  log.info(`» Generated ${notes.changes.length} change entries`);

  // 4. FORMAT
  const formatted = formatNotes(notes, format);

  // 5. PUBLISH
  const publishedTo: string[] = [];

  if (!options.dryRun) {
    for (const target of config.publish) {
      try {
        if (!isPublisherAllowed(target.type, license)) {
          log.info(`» Skipping ${target.type} — ${upgradeMessage(`${target.type} publishing`)}`);
          continue;
        }

        const publisherFactory = getPublisher(target.type);
        if (!publisherFactory) {
          log.info(`» Skipping ${target.type} — install @cullit/pro to enable`);
          continue;
        }

        let publisher;
        switch (target.type) {
          case 'stdout':
            publisher = publisherFactory();
            break;
          case 'file':
            if (!target.path) continue;
            publisher = publisherFactory(target.path);
            break;
          case 'slack':
          case 'discord':
            if (!target.webhookUrl) continue;
            publisher = publisherFactory(target.webhookUrl);
            break;
          case 'github-release':
            publisher = publisherFactory();
            break;
          default:
            continue;
        }

        await publisher.publish(notes, format, formatted);
        publishedTo.push(target.type === 'file' ? `file:${target.path}` : target.type);
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
