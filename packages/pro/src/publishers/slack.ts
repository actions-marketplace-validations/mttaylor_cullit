import type { Publisher, ReleaseNotes, OutputFormat } from '@cullit/core';
import { fetchWithTimeout, createLogger } from '@cullit/core';

const log = createLogger();

/**
 * Posts release notes to a Slack channel via webhook.
 */
export class SlackPublisher implements Publisher {
  constructor(private webhookUrl: string) {
    if (!webhookUrl.startsWith('https://hooks.slack.com/') && !webhookUrl.startsWith('https://hooks.slack-gov.com/')) {
      throw new Error('Invalid Slack webhook URL — must start with https://hooks.slack.com/ or https://hooks.slack-gov.com/');
    }
  }

  async publish(notes: ReleaseNotes, _format: OutputFormat): Promise<void> {
    const text = this.buildSlackMessage(notes);

    const response = await fetchWithTimeout(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed (${response.status})`);
    }
    log.info('✓ Published to Slack');
  }

  private buildSlackMessage(notes: ReleaseNotes): string {
    let msg = `*${notes.version}* — ${notes.date}\n`;
    if (notes.summary) msg += `${notes.summary}\n\n`;

    const categoryEmoji: Record<string, string> = {
      features: '✨', fixes: '🐛', breaking: '⚠️',
      improvements: '🔧', chores: '🧹', other: '📝'
    };

    for (const change of notes.changes) {
      const emoji = categoryEmoji[change.category] || '•';
      msg += `${emoji} ${change.description}`;
      if (change.ticketKey) msg += ` (\`${change.ticketKey}\`)`;
      msg += '\n';
    }

    return msg;
  }
}
