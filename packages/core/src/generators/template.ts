import type { Generator, EnrichedContext, AIConfig, ReleaseNotes, ChangeEntry, ChangeCategory } from '../types';

/**
 * Template-based release notes generator — no AI required.
 * Groups commits by conventional commit prefix and ticket type.
 * Useful as a free demo, CI fallback, or air-gapped environments.
 */
export class TemplateGenerator implements Generator {
  async generate(context: EnrichedContext, config: AIConfig): Promise<ReleaseNotes> {
    const { diff, tickets } = context;
    const changes: ChangeEntry[] = [];

    // Build a lookup of ticket metadata by key
    const ticketMap = new Map(tickets.map(t => [t.key, t]));

    for (const commit of diff.commits) {
      const category = this.categorize(commit.message, commit.issueKeys, ticketMap);
      const description = this.cleanMessage(commit.message);

      // Skip trivial commits
      if (this.isTrivial(description)) continue;

      changes.push({
        description,
        category,
        ticketKey: commit.issueKeys?.[0],
        commits: [commit.shortHash],
      });
    }

    // Deduplicate similar entries (e.g. same ticket referenced in multiple commits)
    const deduped = this.deduplicateByTicket(changes);

    // Sort: breaking first, then features, other categories follow
    const categoryOrder: ChangeCategory[] = ['breaking', 'features', 'improvements', 'fixes', 'chores', 'other'];
    deduped.sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));

    const contributors = [...new Set(diff.commits.map(c => c.author))];

    // Use the latest commit's date (the tag target), not today's date
    const tagDate = diff.commits.length > 0
      ? new Date(diff.commits[0].date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    return {
      version: diff.to,
      date: tagDate,
      summary: this.buildSummary(deduped, diff.commits.length, config.tone),
      changes: deduped.slice(0, 20),
      contributors,
      metadata: {
        commitCount: diff.commits.length,
        prCount: diff.commits.filter(c => c.prNumber).length,
        ticketCount: tickets.length,
        generatedBy: 'cullit-template',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private categorize(
    message: string,
    issueKeys: string[] | undefined,
    ticketMap: Map<string, { type?: string; labels?: string[] }>
  ): ChangeCategory {
    const lower = message.toLowerCase();

    // Conventional commits
    if (/^(feat|feature)[(!:]/.test(lower)) return 'features';
    if (/^fix[(!:]/.test(lower)) return 'fixes';
    if (/^breaking[ -]?change/i.test(lower) || lower.includes('!:')) return 'breaking';
    if (/^(refactor|perf|improve)[(!:]/.test(lower)) return 'improvements';
    if (/^(chore|ci|build|docs|style|test)[(!:]/.test(lower)) return 'chores';

    // Ticket type inference
    if (issueKeys?.length) {
      for (const key of issueKeys) {
        const ticket = ticketMap.get(key);
        if (ticket?.type) {
          if (['bug', 'bugfix', 'defect'].includes(ticket.type)) return 'fixes';
          if (['feature', 'story', 'enhancement'].includes(ticket.type)) return 'features';
          if (['improvement', 'refactor'].includes(ticket.type)) return 'improvements';
          if (['task', 'chore', 'sub-task'].includes(ticket.type)) return 'chores';
        }
      }
    }

    // Keyword fallback
    if (/\b(add|new|implement|introduce|create)\b/i.test(lower)) return 'features';
    if (/\b(fix|resolve|patch|correct|repair)\b/i.test(lower)) return 'fixes';
    if (/\b(update|improve|optimize|enhance|refactor)\b/i.test(lower)) return 'improvements';
    if (/\b(remove|delete|deprecate|drop)\b/i.test(lower)) return 'chores';

    return 'other';
  }

  private cleanMessage(message: string): string {
    // Remove conventional commit prefixes
    let cleaned = message.replace(/^(feat|fix|chore|docs|style|refactor|perf|test|ci|build|breaking change)(\(.+?\))?[!]?:\s*/i, '');
    // Capitalize first letter
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    // Remove trailing period if present
    cleaned = cleaned.replace(/\.$/, '');
    return cleaned;
  }

  private isTrivial(description: string): boolean {
    const trivialPatterns = [
      /^merge\b/i,
      /^wip\b/i,
      /^typo\b/i,
      /^formatting\b/i,
      /^lint\b/i,
      /^whitespace\b/i,
      /^bump version/i,
    ];
    return trivialPatterns.some(p => p.test(description));
  }

  private deduplicateByTicket(changes: ChangeEntry[]): ChangeEntry[] {
    const seen = new Map<string, ChangeEntry>();
    const result: ChangeEntry[] = [];

    for (const change of changes) {
      if (change.ticketKey && seen.has(change.ticketKey)) {
        // Merge commits into existing entry
        const existing = seen.get(change.ticketKey)!;
        if (change.commits) {
          existing.commits = [...(existing.commits || []), ...change.commits];
        }
      } else {
        if (change.ticketKey) seen.set(change.ticketKey, change);
        result.push(change);
      }
    }

    return result;
  }

  private buildSummary(changes: ChangeEntry[], commitCount: number, tone?: string): string {
    const counts: Record<string, number> = {};
    for (const c of changes) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }

    const parts: string[] = [];
    if (counts['breaking']) parts.push(`${counts['breaking']} breaking change${counts['breaking'] > 1 ? 's' : ''}`);
    if (counts['features']) parts.push(`${counts['features']} feature${counts['features'] > 1 ? 's' : ''}`);
    if (counts['fixes']) parts.push(`${counts['fixes']} fix${counts['fixes'] > 1 ? 'es' : ''}`);
    if (counts['improvements']) parts.push(`${counts['improvements']} improvement${counts['improvements'] > 1 ? 's' : ''}`);

    if (tone === 'terse') {
      return parts.length > 0 ? parts.join(', ') : `${commitCount} commits`;
    }

    if (tone === 'casual') {
      if (parts.length === 0) return `A quick update with ${commitCount} commits — nothing too wild.`;
      return `We've got ${parts.join(', ')} packed into ${commitCount} commits. Let's go!`;
    }

    if (tone === 'edgy') {
      if (parts.length === 0) return `${commitCount} commits. No fluff. Just code that needed to exist.`;
      return `Shipped: ${parts.join(', ')}. ${commitCount} commits. Zero apologies.`;
    }

    if (tone === 'hype') {
      if (parts.length === 0) return `🔥 ${commitCount} commits just dropped and they're INCREDIBLE!`;
      return `🚀 HUGE release! ${parts.join(', ')} across ${commitCount} commits! This changes EVERYTHING!`;
    }

    if (tone === 'snarky') {
      if (parts.length === 0) return `${commitCount} commits. We were bored, okay?`;
      return `Oh look, ${parts.join(', ')} from ${commitCount} commits. You're welcome.`;
    }

    // Default: professional
    return parts.length > 0
      ? `This release includes ${parts.join(', ')} across ${commitCount} commits.`
      : `This release includes ${commitCount} commits.`;
  }
}
