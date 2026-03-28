import { describe, it, expect } from 'vitest';
import {
  getTierLimits,
  isProviderAllowed,
  isPublisherAllowed,
  isEnrichmentAllowed,
  isAudienceToneAllowed,
  isFeatureAllowed,
} from '@cullit/core';
import { getEffectiveTier } from '../src/auth.js';

type Tier = 'free' | 'basic' | 'pro' | 'team' | 'enterprise';
type LicenseInfo = { tier: Tier; valid: boolean };

interface MockUser {
  tier: Tier;
}

function makeUser(input: MockUser) {
  return {
    id: 'u1',
    login: 'octocat',
    name: 'Octo Cat',
    email: 'octo@example.com',
    avatarUrl: '',
    tier: input.tier,
    orgId: null,
    role: 'member' as const,
    apiKey: 'clt_' + 'a'.repeat(32),
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
}

function licenseForTier(tier: Tier): LicenseInfo {
  return { tier, valid: true };
}

describe('Tier workflow matrix', () => {
  const scenarios: Array<{
    name: string;
    userTier: Tier;
    expectedEffectiveTier: Tier;
    expectAiProvider: boolean;
    expectSlackPublisher: boolean;
    expectTeamPublisher: boolean;
    expectDrafts: boolean;
    expectSso: boolean;
  }> = [
    {
      name: 'free plan',
      userTier: 'free',
      expectedEffectiveTier: 'free',
      expectAiProvider: false,
      expectSlackPublisher: false,
      expectTeamPublisher: false,
      expectDrafts: false,
      expectSso: false,
    },
    {
      name: 'basic plan',
      userTier: 'basic',
      expectedEffectiveTier: 'basic',
      expectAiProvider: true,
      expectSlackPublisher: true,
      expectTeamPublisher: false,
      expectDrafts: false,
      expectSso: false,
    },
    {
      name: 'pro plan',
      userTier: 'pro',
      expectedEffectiveTier: 'pro',
      expectAiProvider: true,
      expectSlackPublisher: true,
      expectTeamPublisher: false,
      expectDrafts: false,
      expectSso: false,
    },
    {
      name: 'team plan',
      userTier: 'team',
      expectedEffectiveTier: 'team',
      expectAiProvider: true,
      expectSlackPublisher: true,
      expectTeamPublisher: true,
      expectDrafts: true,
      expectSso: false,
    },
    {
      name: 'enterprise plan',
      userTier: 'enterprise',
      expectedEffectiveTier: 'enterprise',
      expectAiProvider: true,
      expectSlackPublisher: true,
      expectTeamPublisher: true,
      expectDrafts: true,
      expectSso: true,
    },
  ];

  for (const scenario of scenarios) {
    it(`enforces workflow for ${scenario.name}`, () => {
      const user = makeUser({ tier: scenario.userTier });
      const effectiveTier = getEffectiveTier(user);
      const license = licenseForTier(effectiveTier);
      const limits = getTierLimits(effectiveTier);

      expect(effectiveTier).toBe(scenario.expectedEffectiveTier);

      expect(isProviderAllowed('anthropic', license)).toBe(scenario.expectAiProvider);
      expect(isProviderAllowed('none', license)).toBe(true);
      expect(isEnrichmentAllowed(license)).toBe(
        scenario.userTier === 'pro' || scenario.userTier === 'team' || scenario.userTier === 'enterprise'
      );
      expect(isAudienceToneAllowed(license)).toBe(
        scenario.userTier === 'pro' || scenario.userTier === 'team' || scenario.userTier === 'enterprise'
      );

      expect(isPublisherAllowed('stdout', license)).toBe(true);
      expect(isPublisherAllowed('file', license)).toBe(true);
      expect(isPublisherAllowed('slack', license)).toBe(scenario.expectSlackPublisher);
      expect(isPublisherAllowed('teams', license)).toBe(scenario.expectTeamPublisher);

      expect(isFeatureAllowed('drafts', effectiveTier)).toBe(scenario.expectDrafts);
      expect(isFeatureAllowed('sso', effectiveTier)).toBe(scenario.expectSso);

      if (effectiveTier === 'free') {
        expect(limits.generationsPerMonth).toBe(5);
      }
      if (effectiveTier === 'basic') {
        expect(limits.generationsPerMonth).toBe(50);
      }
      if (effectiveTier === 'pro') {
        expect(limits.generationsPerMonth).toBe(500);
      }
      if (effectiveTier === 'team') {
        expect(limits.generationsPerMonth).toBe(2000);
      }
      if (effectiveTier === 'enterprise') {
        expect(limits.generationsPerMonth).toBe(Infinity);
      }
    });
  }

});

