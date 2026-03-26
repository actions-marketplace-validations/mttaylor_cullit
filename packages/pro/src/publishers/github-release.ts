import type { Publisher, ReleaseNotes, OutputFormat } from '@cullit/core';
import { formatNotes, fetchWithTimeout, createLogger } from '@cullit/core';

const log = createLogger();

/**
 * Creates or updates a GitHub Release via the GitHub API.
 * Requires GITHUB_TOKEN env var (provided automatically in GitHub Actions).
 */
export class GitHubReleasePublisher implements Publisher {
  private token: string;
  private owner: string;
  private repo: string;

  constructor() {
    this.token = process.env['GITHUB_TOKEN'] || '';
    const ghRepo = process.env['GITHUB_REPOSITORY'] || '';
    const parts = ghRepo.split('/');
    this.owner = parts[0] || '';
    this.repo = parts[1] || '';
  }

  async publish(notes: ReleaseNotes, format: OutputFormat, preformatted?: string): Promise<void> {
    if (!this.token) {
      throw new Error('GITHUB_TOKEN is required for GitHub Release publishing');
    }
    if (!this.owner || !this.repo) {
      throw new Error(
        'GITHUB_REPOSITORY env var is required (format: owner/repo). ' +
        'This is set automatically in GitHub Actions.'
      );
    }

    const formatted = preformatted || formatNotes(notes, format);
    const tagName = notes.version.startsWith('v') ? notes.version : `v${notes.version}`;

    const existing = await this.getRelease(tagName);

    if (existing) {
      await this.updateRelease(existing.id, formatted, notes);
      log.info(`✓ Updated GitHub Release: ${tagName}`);
    } else {
      await this.createRelease(tagName, formatted, notes);
      log.info(`✓ Created GitHub Release: ${tagName}`);
    }
  }

  private async getRelease(tag: string): Promise<{ id: number } | null> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/tags/${encodeURIComponent(tag)}`;
    const response = await fetchWithTimeout(url, {
      headers: this.headers(),
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${error}`);
    }

    const data = await response.json() as { id: number };
    return data;
  }

  private async createRelease(tag: string, body: string, notes: ReleaseNotes): Promise<void> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        tag_name: tag,
        name: `${tag} — ${notes.date}`,
        body,
        draft: false,
        prerelease: tag.includes('-'),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub Release creation failed (${response.status}): ${error}`);
    }
  }

  private async updateRelease(id: number, body: string, notes: ReleaseNotes): Promise<void> {
    const tag = notes.version.startsWith('v') ? notes.version : `v${notes.version}`;
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/${id}`;
    const response = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({
        body,
        name: `${tag} — ${notes.date}`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub Release update failed (${response.status}): ${error}`);
    }
  }

  private headers(): Record<string, string> {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}
