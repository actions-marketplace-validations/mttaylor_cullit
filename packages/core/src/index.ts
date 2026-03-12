export type { 
  CullConfig, AIConfig, GitDiff, GitCommit,
  ReleaseNotes, ChangeEntry, ChangeCategory,
  EnrichedTicket, EnrichedContext,
  Collector, Enricher, Generator, Publisher,
  PipelineResult, OutputFormat, PublishTarget,
} from './types';

export { GitCollector, getRecentTags, getLatestTag } from './collectors/git';
export { AIGenerator } from './generators/ai';
export { formatNotes } from './formatter';
export { StdoutPublisher, FilePublisher, SlackPublisher, DiscordPublisher } from './publishers/index';
export { JiraEnricher } from './enrichers/jira';
export { LinearEnricher } from './enrichers/linear';

import type { CullConfig, EnrichedContext, PipelineResult, OutputFormat, EnrichedTicket } from './types';
import { GitCollector } from './collectors/git';
import { AIGenerator } from './generators/ai';
import { formatNotes } from './formatter';
import { StdoutPublisher, FilePublisher, SlackPublisher, DiscordPublisher } from './publishers/index';
import { JiraEnricher } from './enrichers/jira';
import { LinearEnricher } from './enrichers/linear';

/**
 * Main pipeline: Collect → Enrich → Generate → Format → Publish
 */
export async function runPipeline(
  from: string,
  to: string,
  config: CullConfig,
  options: { format?: OutputFormat; dryRun?: boolean } = {}
): Promise<PipelineResult> {
  const startTime = Date.now();
  const format = options.format || 'markdown';

  // 1. COLLECT
  console.log(`» Collecting commits between ${from}..${to}`);
  const collector = new GitCollector();
  const diff = await collector.collect(from, to);
  console.log(`» Found ${diff.commits.length} commits, ${diff.filesChanged || 0} files changed`);

  if (diff.commits.length === 0) {
    throw new Error(`No commits found between ${from} and ${to}`);
  }

  // 2. ENRICH
  const tickets: EnrichedTicket[] = [];
  const enrichmentSources = config.source.enrichment || [];

  for (const source of enrichmentSources) {
    if (source === 'jira' && config.jira) {
      console.log('» Enriching from Jira...');
      const enricher = new JiraEnricher(config.jira);
      const jiraTickets = await enricher.enrich(diff);
      tickets.push(...jiraTickets);
      console.log(`» Jira: found ${jiraTickets.length} tickets`);
    }

    if (source === 'linear') {
      console.log('» Enriching from Linear...');
      const enricher = new LinearEnricher(config.linear?.apiKey);
      const linearTickets = await enricher.enrich(diff);
      tickets.push(...linearTickets);
      console.log(`» Linear: found ${linearTickets.length} issues`);
    }
  }

  const context: EnrichedContext = { diff, tickets };

  // 3. GENERATE
  const providerName = config.ai.provider === 'anthropic' ? 'Claude' : 'OpenAI';
  const modelName = config.ai.model || (config.ai.provider === 'anthropic' ? 'sonnet-4' : 'gpt-4o');
  console.log(`» Generating with ${providerName} (${modelName})...`);

  const generator = new AIGenerator();
  const notes = await generator.generate(context, config.ai);
  console.log(`» Generated ${notes.changes.length} change entries`);

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
            // TODO: Implement GitHub Release publisher
            console.log('» GitHub Release publisher coming in v1.1');
            break;
        }
      } catch (err) {
        console.error(`✗ Failed to publish to ${target.type}: ${(err as Error).message}`);
      }
    }
  } else {
    console.log('\n[DRY RUN — Not publishing]\n');
    console.log(formatted);
    publishedTo.push('dry-run');
  }

  const duration = Date.now() - startTime;
  console.log(`\n✓ Done in ${(duration / 1000).toFixed(1)}s`);

  return { notes, formatted, publishedTo, duration };
}
