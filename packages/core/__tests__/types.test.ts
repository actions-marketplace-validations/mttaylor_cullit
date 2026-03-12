import { describe, it, expect } from 'vitest';
import type {
  CullConfig, AIConfig, SourceConfig, PublishTarget,
  GitCommit, GitDiff, ChangeCategory, ReleaseNotes,
  EnrichedTicket, PipelineResult, OutputFormat,
} from '../src/types';

describe('types', () => {
  it('AIConfig validates provider enum values', () => {
    const config: AIConfig = {
      provider: 'anthropic',
      audience: 'developer',
      tone: 'professional',
      categories: ['features', 'fixes'],
    };
    expect(config.provider).toBe('anthropic');
  });

  it('SourceConfig supports all source types', () => {
    const sources: SourceConfig['type'][] = ['local', 'jira', 'linear'];
    expect(sources).toHaveLength(3);
  });

  it('CullConfig composes correctly', () => {
    const config: CullConfig = {
      ai: {
        provider: 'openai',
        audience: 'end-user',
        tone: 'casual',
        categories: ['features'],
      },
      source: { type: 'local' },
      publish: [{ type: 'stdout' }],
    };
    expect(config.ai.provider).toBe('openai');
    expect(config.publish).toHaveLength(1);
  });

  it('GitCommit can have optional fields', () => {
    const commit: GitCommit = {
      hash: 'abc123def456',
      shortHash: 'abc123d',
      author: 'matt',
      date: '2026-03-12',
      message: 'feat: add AI generation',
    };
    expect(commit.prNumber).toBeUndefined();
    expect(commit.issueKeys).toBeUndefined();
  });

  it('ChangeCategory covers all expected values', () => {
    const cats: ChangeCategory[] = [
      'features', 'fixes', 'breaking', 'improvements', 'chores', 'other',
    ];
    expect(cats).toHaveLength(6);
  });

  it('PublishTarget supports all publisher types', () => {
    const targets: PublishTarget[] = [
      { type: 'stdout' },
      { type: 'file', path: 'RELEASE_NOTES.md' },
      { type: 'slack', webhookUrl: 'https://hooks.slack.com/x' },
      { type: 'discord', webhookUrl: 'https://discord.com/webhook/x' },
      { type: 'github-release' },
    ];
    expect(targets).toHaveLength(5);
  });
});
