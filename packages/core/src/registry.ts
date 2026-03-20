/**
 * Plugin Registry — the seam between free (core) and pro features.
 *
 * Core registers: git collector, template generator, stdout/file publishers.
 * Pro registers:  AI generator, Jira/Linear collectors + enrichers, Slack/Discord/GitHub publishers.
 *
 * Paid plugin registration is preloaded by the licensed distribution package.
 */

import type { Collector, Enricher, Generator, Publisher } from './types';

// --- Factory types ---

export type CollectorFactory = (...args: any[]) => Collector;
export type EnricherFactory = (...args: any[]) => Enricher;
export type GeneratorFactory = (...args: any[]) => Generator;
export type PublisherFactory = (...args: any[]) => Publisher;

// --- Registries ---

const collectors = new Map<string, CollectorFactory>();
const enrichers = new Map<string, EnricherFactory>();
const generators = new Map<string, GeneratorFactory>();
const publishers = new Map<string, PublisherFactory>();

// --- Registration ---

export function registerCollector(type: string, factory: CollectorFactory): void {
  collectors.set(type, factory);
}

export function registerEnricher(type: string, factory: EnricherFactory): void {
  enrichers.set(type, factory);
}

export function registerGenerator(provider: string, factory: GeneratorFactory): void {
  generators.set(provider, factory);
}

export function registerPublisher(type: string, factory: PublisherFactory): void {
  publishers.set(type, factory);
}

// --- Lookup ---

export function getCollector(type: string): CollectorFactory | undefined {
  return collectors.get(type);
}

export function getEnricher(type: string): EnricherFactory | undefined {
  return enrichers.get(type);
}

export function getGenerator(provider: string): GeneratorFactory | undefined {
  return generators.get(provider);
}

export function getPublisher(type: string): PublisherFactory | undefined {
  return publishers.get(type);
}

export function hasGenerator(provider: string): boolean {
  return generators.has(provider);
}

export function hasCollector(type: string): boolean {
  return collectors.has(type);
}

export function hasPublisher(type: string): boolean {
  return publishers.has(type);
}

export function hasEnricher(type: string): boolean {
  return enrichers.has(type);
}

// --- Discoverability ---

export function listCollectors(): string[] {
  return Array.from(collectors.keys());
}

export function listEnrichers(): string[] {
  return Array.from(enrichers.keys());
}

export function listGenerators(): string[] {
  return Array.from(generators.keys());
}

export function listPublishers(): string[] {
  return Array.from(publishers.keys());
}
