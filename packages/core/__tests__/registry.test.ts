import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCollector, registerEnricher, registerGenerator, registerPublisher,
  getCollector, getEnricher, getGenerator, getPublisher,
  hasCollector, hasEnricher, hasGenerator, hasPublisher,
  listCollectors, listEnrichers, listGenerators, listPublishers,
} from '../src/registry';
import type { GitDiff, EnrichedTicket, ReleaseNotes } from '../src/types';

const stubDiff: GitDiff = { from: 'v0', to: 'v1', commits: [] };

// The registry uses module-level Maps.  Built-in plugins (git, template, stdout, file)
// are registered by core's index.ts which may or may not be loaded depending on import
// order.  We test with unique names to avoid coupling to built-in registrations.

describe('Registry — register + lookup', () => {
  it('registers and retrieves a collector factory', () => {
    const factory = () => ({ collect: async () => stubDiff });
    registerCollector('test-collector', factory);
    expect(getCollector('test-collector')).toBe(factory);
    expect(hasCollector('test-collector')).toBe(true);
  });

  it('registers and retrieves an enricher factory', () => {
    const factory = () => ({ enrich: async (): Promise<EnrichedTicket[]> => [] });
    registerEnricher('test-enricher', factory);
    expect(getEnricher('test-enricher')).toBe(factory);
    expect(hasEnricher('test-enricher')).toBe(true);
  });

  it('registers and retrieves a generator factory', () => {
    const factory = () => ({ generate: async (): Promise<ReleaseNotes> => ({ version: '', date: '', summary: '', changes: [] }) });
    registerGenerator('test-generator', factory);
    expect(getGenerator('test-generator')).toBe(factory);
    expect(hasGenerator('test-generator')).toBe(true);
  });

  it('registers and retrieves a publisher factory', () => {
    const factory = () => ({ publish: async () => {} });
    registerPublisher('test-publisher', factory);
    expect(getPublisher('test-publisher')).toBe(factory);
    expect(hasPublisher('test-publisher')).toBe(true);
  });
});

describe('Registry — missing keys', () => {
  it('returns undefined for unregistered collector', () => {
    expect(getCollector('nonexistent-collector')).toBeUndefined();
    expect(hasCollector('nonexistent-collector')).toBe(false);
  });

  it('returns undefined for unregistered enricher', () => {
    expect(getEnricher('nonexistent-enricher')).toBeUndefined();
    expect(hasEnricher('nonexistent-enricher')).toBe(false);
  });

  it('returns undefined for unregistered generator', () => {
    expect(getGenerator('nonexistent-generator')).toBeUndefined();
    expect(hasGenerator('nonexistent-generator')).toBe(false);
  });

  it('returns undefined for unregistered publisher', () => {
    expect(getPublisher('nonexistent-publisher')).toBeUndefined();
    expect(hasPublisher('nonexistent-publisher')).toBe(false);
  });
});

describe('Registry — discoverability', () => {
  it('listCollectors includes registered types', () => {
    registerCollector('list-test-col', () => ({ collect: async () => stubDiff }));
    expect(listCollectors()).toContain('list-test-col');
  });

  it('listEnrichers includes registered types', () => {
    registerEnricher('list-test-enr', () => ({ enrich: async (): Promise<EnrichedTicket[]> => [] }));
    expect(listEnrichers()).toContain('list-test-enr');
  });

  it('listGenerators includes registered types', () => {
    registerGenerator('list-test-gen', () => ({ generate: async (): Promise<ReleaseNotes> => ({ version: '', date: '', summary: '', changes: [] }) }));
    expect(listGenerators()).toContain('list-test-gen');
  });

  it('listPublishers includes registered types', () => {
    registerPublisher('list-test-pub', () => ({ publish: async () => {} }));
    expect(listPublishers()).toContain('list-test-pub');
  });
});

describe('Registry — overwrite behavior', () => {
  it('overwrites a collector with the same name', () => {
    const first = () => ({ collect: async () => stubDiff });
    const second = () => ({ collect: async () => ({ ...stubDiff, commits: [{ hash: 'abc', shortHash: 'abc', message: 'new', author: '', date: '' }] }) });
    registerCollector('overwrite-col', first);
    registerCollector('overwrite-col', second);
    expect(getCollector('overwrite-col')).toBe(second);
  });
});
