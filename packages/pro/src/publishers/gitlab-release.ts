import type { Publisher, ReleaseNotes, OutputFormat } from '@cullit/core';
import { formatNotes, fetchWithTimeout, createLogger } from '@cullit/core';

const log = createLogger();

/**
 * Creates or updates a GitLab Release via the GitLab API.
 * Works with both gitlab.com and self-hosted instances.
 *
 * Requires GITLAB_TOKEN env var.
 * Uses GITLAB_PROJECT_ID env var or config.
 */
export class GitLabReleasePublisher implements Publisher {
  private token: string;
  private domain: string;
  private projectId: string;

  constructor(config?: { domain?: string; projectId?: string }) {
    this.token = process.env.GITLAB_TOKEN || '';
    this.domain = config?.domain || process.env.GITLAB_DOMAIN || 'gitlab.com';
    this.projectId = config?.projectId || process.env.GITLAB_PROJECT_ID || '';

    if (!/^[a-zA-Z0-9.-]+$/.test(this.domain)) {
      throw new Error('Invalid GitLab domain — must be a valid hostname');
    }
    if (!this.token) {
      throw new Error('GITLAB_TOKEN is required for GitLab Release publishing');
    }
    if (!this.projectId) {
      throw new Error('GitLab project ID is required. Set GITLAB_PROJECT_ID or configure in .cullit.yml');
    }
  }

  async publish(notes: ReleaseNotes, format: OutputFormat, preformatted?: string): Promise<void> {
    const body = preformatted || formatNotes(notes, format);
    const tagName = notes.version.startsWith('v') ? notes.version : `v${notes.version}`;

    const existing = await this.getRelease(tagName);

    if (existing) {
      await this.updateRelease(tagName, body, notes);
      log.info(`✓ Updated GitLab Release: ${tagName}`);
    } else {
      await this.createRelease(tagName, body, notes);
      log.info(`✓ Created GitLab Release: ${tagName}`);
    }
  }

  private async getRelease(tag: string): Promise<boolean> {
    const url = `https://${this.domain}/api/v4/projects/${encodeURIComponent(this.projectId)}/releases/${encodeURIComponent(tag)}`;

    const res = await fetchWithTimeout(url, { headers: this.headers() });
    return res.ok;
  }

  private async createRelease(tag: string, body: string, notes: ReleaseNotes): Promise<void> {
    const url = `https://${this.domain}/api/v4/projects/${encodeURIComponent(this.projectId)}/releases`;

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        tag_name: tag,
        name: `${tag} — ${notes.date}`,
        description: body,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`GitLab Release creation failed (${res.status}): ${error}`);
    }
  }

  private async updateRelease(tag: string, body: string, notes: ReleaseNotes): Promise<void> {
    const url = `https://${this.domain}/api/v4/projects/${encodeURIComponent(this.projectId)}/releases/${encodeURIComponent(tag)}`;

    const res = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({
        name: `${tag} — ${notes.date}`,
        description: body,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`GitLab Release update failed (${res.status}): ${error}`);
    }
  }

  private headers(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.token,
      'Content-Type': 'application/json',
    };
  }
}
