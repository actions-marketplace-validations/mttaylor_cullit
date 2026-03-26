import type { Publisher, ReleaseNotes, OutputFormat } from '@cullit/core';
import { formatNotes, fetchWithTimeout, createLogger } from '@cullit/core';

const log = createLogger();

/**
 * Publishes release notes to a Cullit Hosted Changelog page.
 *
 * Each publish pushes the release to your hosted changelog at:
 *   https://cullit.io/{org}/changelog  (free, Cullit-branded)
 *   https://changelog.yourdomain.com   (pro, custom domain)
 *
 * Requires CULLIT_API_KEY env var.
 * Config (optional):
 *   - project: project slug for multi-project changelogs
 */
export class ChangelogPublisher implements Publisher {
  private apiKey: string;
  private project: string;
  private apiUrl: string;

  constructor(config?: { project?: string }) {
    this.apiKey = process.env.CULLIT_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('CULLIT_API_KEY is required for hosted changelog publishing. Get one at https://cullit.io/pricing');
    }

    this.project = config?.project || 'default';
    this.apiUrl = process.env.CULLIT_CHANGELOG_URL || 'https://api.cullit.io/v1/changelog';
  }

  async publish(notes: ReleaseNotes, format: OutputFormat, preformatted?: string): Promise<void> {
    const markdown = format === 'markdown'
      ? (preformatted || formatNotes(notes, 'markdown'))
      : formatNotes(notes, 'markdown');

    const html = formatNotes(notes, 'html');

    const payload = {
      project: this.project,
      version: notes.version,
      date: notes.date,
      summary: notes.summary || '',
      changes: notes.changes,
      contributors: notes.contributors || [],
      metadata: notes.metadata,
      formatted: {
        markdown,
        html,
      },
    };

    const res = await fetchWithTimeout(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Changelog publish failed (${res.status}): ${error}`);
    }

    const data = await res.json() as { url?: string };
    const url = data.url || `https://cullit.io/changelog/${this.project}`;
    log.info(`✓ Published to hosted changelog: ${url}`);
  }
}
