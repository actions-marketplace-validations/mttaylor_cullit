export type { 
  CullConfig, AIConfig, GitDiff, GitCommit,
  ReleaseNotes, ChangeEntry, ChangeCategory,
  EnrichedTicket, EnrichedContext,
  Collector, Enricher, Generator, Publisher,
  PipelineResult, OutputFormat, PublishTarget,
  AIProvider, Audience, Tone,
  SourceConfig, PublisherType, EnrichmentType,
  JiraConfig, LinearConfig, RepoSource, TemplateProfile, TemplateConfig,
  GitLabConfig, BitbucketConfig, ConfluenceConfig, NotionConfig,
} from './types';
export {
  VERSION, DEFAULT_CATEGORIES, DEFAULT_MODELS,
  AI_PROVIDERS, OUTPUT_FORMATS, PUBLISHER_TYPES, ENRICHMENT_TYPES,
  CHANGE_CATEGORIES, AUDIENCES, TONES, SOURCE_TYPES,
  TIERS, PAID_TIERS,
  PAID_SEAT_PRICE, PAID_MIN_SEATS, PAID_ANNUAL_DISCOUNT,
} from './constants';
export { createLogger } from './logger';
export type { Logger, LogLevel } from './logger';
import { DEFAULT_MODELS } from './constants';
import { createLogger, type Logger } from './logger';

export { GitCollector, getRecentTags, getLatestTag } from './collectors/git';
export { MultiRepoCollector } from './collectors/multi-repo';
export { TemplateGenerator } from './generators/template';
export { formatNotes, registerFormatter, getFormatter, listFormatters, escapeHtml } from './formatter';
export { StdoutPublisher, FilePublisher } from './publishers/index';
export { analyzeReleaseReadiness } from './advisor';
export type { ReleaseAdvisory, SemverBump } from './advisor';
export { resolveLicense, validateLicense, isProviderAllowed, isPublisherAllowed, isEnrichmentAllowed, isAudienceToneAllowed, upgradeMessage, getTierLimits, getTeamLimits, reportUsage, isFeatureAllowed, isPlanFeatureAllowed, getFeatureGating } from './gate';
export type { LicenseTier, LicenseStatus, UsageLimits, TeamFeature } from './gate';
export {
  registerCollector, registerEnricher, registerGenerator, registerPublisher,
  getCollector, getEnricher, getGenerator, getPublisher,
  hasCollector, hasEnricher, hasGenerator, hasPublisher,
  listCollectors, listEnrichers, listGenerators, listPublishers,
} from './registry';
export type { CollectorFactory, EnricherFactory, GeneratorFactory, PublisherFactory } from './registry';
export { fetchWithTimeout } from './fetch';
export { createRateLimiter } from './rate-limiter';
export type { RateLimiter, RateLimitResult, RateLimiterOptions } from './rate-limiter';
export { CullitError, CoreErrorCode } from './errors';
export type { CoreErrorCodeValue } from './errors';
export { verifyIntegrations, formatVerifyResults } from './verify';
export type { VerifyResult, VerifyStatus, VerifyOptions } from './verify';

import type { CullConfig, EnrichedContext, PipelineResult, OutputFormat, EnrichedTicket, ReleaseNotes, TemplateProfile, TemplateConfig, PublishTarget } from './types';
import { CullitError, CoreErrorCode } from './errors';
import { validateLicense, isProviderAllowed, isPublisherAllowed, isEnrichmentAllowed, isAudienceToneAllowed, upgradeMessage } from './gate';
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
registerCollector('local', (config: CullConfig) => new GitCollector(config.source?.repoPath));
registerCollector('multi-repo', (config: CullConfig) => {
  if (!config.repos?.length) throw new Error('Multi-repo source requires "repos" array in config');
  return new MultiRepoCollector(config.repos);
});
registerGenerator('none', () => new TemplateGenerator());
registerPublisher('stdout', (_target: PublishTarget) => new StdoutPublisher());
registerPublisher('file', (target: PublishTarget) => new FilePublisher(target.path!));

type ResolvedTemplate = {
  name?: string;
  format?: OutputFormat;
  sectionOrder?: string[];
  includeContributors?: boolean;
  includeMetadata?: boolean;
  summaryPrefix?: string;
};

function normalizeSectionOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const order = value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean);
  return order.length ? order : undefined;
}

function toResolvedTemplate(profile?: TemplateProfile | TemplateConfig | null): ResolvedTemplate {
  if (!profile) return {};
  const p = profile as Record<string, unknown>;
  return {
    format: typeof p.format === 'string' ? (p.format as OutputFormat) : undefined,
    sectionOrder: normalizeSectionOrder(p.sectionOrder),
    includeContributors: typeof p.includeContributors === 'boolean' ? p.includeContributors : undefined,
    includeMetadata: typeof p.includeMetadata === 'boolean' ? p.includeMetadata : undefined,
    summaryPrefix: typeof p.summaryPrefix === 'string' ? p.summaryPrefix : undefined,
  };
}

function mergeTemplates(...templates: Array<ResolvedTemplate | undefined>): ResolvedTemplate {
  const merged: ResolvedTemplate = {};
  for (const template of templates) {
    if (!template) continue;
    if (template.name) merged.name = template.name;
    if (template.format) merged.format = template.format;
    if (template.sectionOrder) merged.sectionOrder = template.sectionOrder;
    if (typeof template.includeContributors === 'boolean') merged.includeContributors = template.includeContributors;
    if (typeof template.includeMetadata === 'boolean') merged.includeMetadata = template.includeMetadata;
    if (typeof template.summaryPrefix === 'string') merged.summaryPrefix = template.summaryPrefix;
  }
  return merged;
}

function getTemplateProfileByName(config: CullConfig, name?: string): ResolvedTemplate | undefined {
  if (!name) return undefined;
  const profile = config.templates?.find(t => t.name === name);
  if (!profile) return undefined;
  return { name, ...toResolvedTemplate(profile) };
}

function applyTemplateToNotes(notes: ReleaseNotes, template: ResolvedTemplate): ReleaseNotes {
  const next: ReleaseNotes = {
    ...notes,
    changes: [...notes.changes],
  };

  if (template.sectionOrder?.length) {
    const index = new Map<string, number>();
    template.sectionOrder.forEach((category, i) => index.set(category, i));
    next.changes = next.changes
      .map((change, i) => ({ change, i }))
      .sort((a, b) => {
        const ai = index.has(a.change.category) ? index.get(a.change.category)! : Number.MAX_SAFE_INTEGER;
        const bi = index.has(b.change.category) ? index.get(b.change.category)! : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return a.i - b.i;
      })
      .map(({ change }) => change);
  }

  if (template.summaryPrefix) {
    const currentSummary = next.summary || '';
    next.summary = `${template.summaryPrefix}${currentSummary ? ` ${currentSummary}` : ''}`.trim();
  }

  if (template.includeContributors === false) {
    delete next.contributors;
  }

  if (template.includeMetadata === false) {
    delete next.metadata;
  }

  return next;
}

/**
 * Main pipeline: Collect → Enrich → Generate → Format → Publish
 */
export async function runPipeline(
  from: string,
  to: string,
  config: CullConfig,
  options: { format?: OutputFormat; dryRun?: boolean; logger?: Logger; templateProfile?: string } = {}
): Promise<PipelineResult> {
  const startTime = Date.now();
  const log = options.logger || createLogger('normal');

  // LICENSE CHECK (async remote validation with cache)
  const license = await validateLicense();

  if (!license.valid) {
    if (!isProviderAllowed(config.ai.provider, license)) {
      throw new CullitError(CoreErrorCode.LICENSE_INVALID, license.message || 'Invalid CULLIT_API_KEY');
    }
    // Invalid key but provider is free-compatible — warn and continue in free mode
    log.warn(`⚠ ${license.message || 'Invalid CULLIT_API_KEY — running in free mode.'}`);
  }

  if (!isProviderAllowed(config.ai.provider, license)) {
    throw new CullitError(CoreErrorCode.LICENSE_TIER_INSUFFICIENT, upgradeMessage(`AI provider "${config.ai.provider}"`, 'pro'));
  }

  // 1. COLLECT — uniform factory pattern: factory(config)
  const collectorFactory = getCollector(config.source.type);
  if (!collectorFactory) {
    throw new CullitError(
      CoreErrorCode.PIPELINE_COLLECTOR_MISSING,
      `Source type "${config.source.type}" is not available. ` +
      (config.source.type !== 'local'
        ? 'Install @cullit/licensed (private distribution) to use this source.'
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
    throw new CullitError(CoreErrorCode.PIPELINE_NO_CHANGES, `No ${itemLabel} found from ${source}`);
  }

  // 2. ENRICH
  const tickets: EnrichedTicket[] = [];
  const enrichmentSources = config.source.enrichment || [];

  for (const source of enrichmentSources) {
    if (!isEnrichmentAllowed(license)) {
      log.info(`» Skipping ${source} enrichment — ${upgradeMessage(`${source} enrichment`, 'pro')}`);
      continue;
    }

    const enricherFactory = getEnricher(source);
    if (!enricherFactory) {
      log.info(`» Skipping ${source} enrichment — install @cullit/licensed to enable`);
      continue;
    }

    log.info(`» Enriching from ${source}...`);
    const enricher = enricherFactory(config);

    try {
      const enrichedTickets = await enricher.enrich(diff);
      tickets.push(...enrichedTickets);
      log.info(`» ${source}: found ${enrichedTickets.length} ${source === 'jira' ? 'tickets' : 'issues'}`);
    } catch (err) {
      log.warn(`⚠ ${source} enrichment failed: ${(err as Error).message || err} — continuing without it`);
    }
  }

  const context: EnrichedContext = { diff, tickets };

  // Audience/tone gating — Pro+ only
  const hasCustomAudience = config.ai.audience && config.ai.audience !== 'developer';
  const hasCustomTone = config.ai.tone && config.ai.tone !== 'professional';
  if ((hasCustomAudience || hasCustomTone) && !isAudienceToneAllowed(license)) {
    throw new CullitError(CoreErrorCode.LICENSE_TIER_INSUFFICIENT, upgradeMessage('Audience and tone control', 'pro'));
  }

  // 3. GENERATE
  const providerNames: Record<string, string> = {
    anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama', none: 'Template',
  };

  const providerName = providerNames[config.ai.provider] || config.ai.provider;
  const modelName = config.ai.provider === 'none' ? 'template' : (config.ai.model || DEFAULT_MODELS[config.ai.provider] || 'default');
  log.info(`» Generating with ${providerName} (${modelName})...`);

  const generatorFactory = getGenerator(config.ai.provider);
  if (!generatorFactory) {
    throw new CullitError(
      CoreErrorCode.PIPELINE_GENERATOR_MISSING,
      `AI provider "${config.ai.provider}" is not available. ` +
      (config.ai.provider !== 'none'
        ? 'Install @cullit/licensed (private distribution) to use AI providers.'
        : '')
    );
  }

  const generator = generatorFactory();

  const notes = await generator.generate(context, config.ai);
  log.info(`» Generated ${notes.changes.length} change entries`);

  const selectedTemplateName = options.templateProfile || config.template?.default;
  const baseTemplate = mergeTemplates(
    toResolvedTemplate(config.template),
    getTemplateProfileByName(config, selectedTemplateName)
  );
  const format = options.format || baseTemplate.format || 'markdown';
  const templatedNotes = applyTemplateToNotes(notes, baseTemplate);

  // 4. FORMAT
  const formatted = formatNotes(templatedNotes, format);

  // 5. PUBLISH
  const publishedTo: string[] = [];
  const renderedCache = new Map<string, { notes: ReleaseNotes; output: string; format: OutputFormat }>();

  if (!options.dryRun) {
    for (const target of config.publish) {
      try {
        if (!isPublisherAllowed(target.type, license)) {
          log.info(`» Skipping ${target.type} — ${upgradeMessage(`${target.type} publishing`, 'pro')}`);
          continue;
        }

        const publisherFactory = getPublisher(target.type);
        if (!publisherFactory) {
          log.info(`» Skipping ${target.type} — install @cullit/licensed to enable`);
          continue;
        }

        // Uniform factory pattern: factory(target)
        const publisher = publisherFactory(target);

        const targetTemplate = mergeTemplates(
          baseTemplate,
          getTemplateProfileByName(config, typeof target.templateProfile === 'string' ? target.templateProfile : undefined),
          {
            format: typeof target.format === 'string' ? (target.format as OutputFormat) : undefined,
            sectionOrder: normalizeSectionOrder(target.sectionOrder),
          }
        );
        const targetFormat = targetTemplate.format || format;

        const cacheKey = JSON.stringify({
          f: targetFormat,
          o: targetTemplate.sectionOrder || null,
          c: targetTemplate.includeContributors,
          m: targetTemplate.includeMetadata,
          s: targetTemplate.summaryPrefix,
        });

        let cached = renderedCache.get(cacheKey);
        if (!cached) {
          const targetNotes = applyTemplateToNotes(notes, targetTemplate);
          const targetOutput = cacheKey === JSON.stringify({
            f: format,
            o: baseTemplate.sectionOrder || null,
            c: baseTemplate.includeContributors,
            m: baseTemplate.includeMetadata,
            s: baseTemplate.summaryPrefix,
          })
            ? formatted
            : formatNotes(targetNotes, targetFormat);
          cached = { notes: targetNotes, output: targetOutput, format: targetFormat };
          renderedCache.set(cacheKey, cached);
        }

        await publisher.publish(cached.notes, cached.format, cached.output);
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

  return { notes: templatedNotes, formatted, publishedTo, duration };
}
