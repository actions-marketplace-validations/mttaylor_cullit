export type { 
  CullConfig, AIConfig, GitDiff, GitCommit,
  ReleaseNotes, ChangeEntry, ChangeCategory,
  EnrichedTicket, EnrichedContext,
  Collector, Enricher, Generator, Publisher,
  PipelineResult, OutputFormat, PublishTarget,
  OpenClawConfig, AIProvider, Audience, Tone,
  SourceConfig, PublisherType, EnrichmentType,
  JiraConfig, LinearConfig, RepoSource,
  GitLabConfig, BitbucketConfig, ConfluenceConfig, NotionConfig,
} from './types';
export {
  VERSION, DEFAULT_CATEGORIES, DEFAULT_MODELS,
  AI_PROVIDERS, OUTPUT_FORMATS, PUBLISHER_TYPES, ENRICHMENT_TYPES,
  CHANGE_CATEGORIES, AUDIENCES, TONES, SOURCE_TYPES,
} from './constants';
export { createLogger } from './logger';
export type { Logger, LogLevel } from './logger';
import { DEFAULT_MODELS } from './constants';
import { createLogger, type Logger } from './logger';

export { GitCollector, getRecentTags, getLatestTag } from './collectors/git';
export { MultiRepoCollector } from './collectors/multi-repo';
export { TemplateGenerator } from './generators/template';
export { formatNotes, registerFormatter, getFormatter, listFormatters } from './formatter';
export { StdoutPublisher, FilePublisher } from './publishers/index';
export { analyzeReleaseReadiness } from './advisor';
export type { ReleaseAdvisory, SemverBump } from './advisor';
export { resolveLicense, validateLicense, isProviderAllowed, isPublisherAllowed, isEnrichmentAllowed, upgradeMessage, getTierLimits, reportUsage } from './gate';
export type { LicenseTier, LicenseStatus, UsageLimits } from './gate';
export {
  registerCollector, registerEnricher, registerGenerator, registerPublisher,
  getCollector, getEnricher, getGenerator, getPublisher,
  hasCollector, hasEnricher, hasGenerator, hasPublisher,
  listCollectors, listEnrichers, listGenerators, listPublishers,
} from './registry';
export type { CollectorFactory, EnricherFactory, GeneratorFactory, PublisherFactory } from './registry';
export { fetchWithTimeout } from './fetch';

import type { CullConfig, EnrichedContext, PipelineResult, OutputFormat, EnrichedTicket } from './types';
import { validateLicense, isProviderAllowed, isPublisherAllowed, isEnrichmentAllowed, upgradeMessage } from './gate';
import { GitCollector } from './collectors/git';
import { MultiRepoCollector } from './collectors/multi-repo';
import { TemplateGenerator } from './generators/template';
import { formatNotes } from './formatter';
import { StdoutPublisher, FilePublisher } from './publishers/index';
import {
  registerCollector, registerGenerator, registerPublisher,
  getCollector, getEnricher, getGenerator, getPublisher,
} from './registry';

// --- Register free (core) plugins ---
import type { PublishTarget, CullConfig as CullConfigType } from './types';
registerCollector('local', (config: CullConfigType) => new GitCollector(config.source?.repoPath));
registerCollector('multi-repo', (config: CullConfigType) => {
  if (!config.repos?.length) throw new Error('Multi-repo source requires "repos" array in config');
  return new MultiRepoCollector(config.repos);
});
registerGenerator('none', () => new TemplateGenerator());
registerPublisher('stdout', (_target: PublishTarget) => new StdoutPublisher());
registerPublisher('file', (target: PublishTarget) => new FilePublisher(target.path!));

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

  // LICENSE CHECK (async remote validation with cache)
  const license = await validateLicense();

  if (!license.valid) {
    throw new Error(license.message || 'Invalid CULLIT_API_KEY');
  }

  if (!isProviderAllowed(config.ai.provider, license)) {
    throw new Error(upgradeMessage(`AI provider "${config.ai.provider}"`));
  }

  // 1. COLLECT — uniform factory pattern: factory(config)
  const collectorFactory = getCollector(config.source.type);
  if (!collectorFactory) {
    throw new Error(
      `Source type "${config.source.type}" is not available. ` +
      (config.source.type !== 'local'
        ? 'Install @cullit/pro to use this source.'
        : 'Valid sources: local')
    );
  }

  const sourceLabel = config.source.type === 'local'
    ? `commits between ${from}..${to}`
    : `items from ${config.source.type}`;
  log.info(`» Collecting ${sourceLabel}`);

  const collector = collectorFactory(config);

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
    const enricher = enricherFactory(config);

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

        // Uniform factory pattern: factory(target)
        const publisher = publisherFactory(target);
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
