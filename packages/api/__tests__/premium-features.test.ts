import { describe, it, expect } from 'vitest';
import { isPlanFeatureAllowed, isFeatureAllowed, getFeatureGating } from '@cullit/core';

describe('Branded Widget Gate', () => {
  it('allows branded widget for team plan', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team', 'team')).toBe(true);
  });

  it('allows branded widget for enterprise', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks branded widget for pro (single user)', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'pro', 'pro')).toBe(false);
  });

  it('blocks branded widget for free', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'free', 'free')).toBe(false);
  });
});

describe('Project Templates Gate', () => {
  it('allows project templates for team plan', () => {
    expect(isPlanFeatureAllowed('project_templates', 'team', 'team')).toBe(true);
  });

  it('allows project templates for enterprise', () => {
    expect(isPlanFeatureAllowed('project_templates', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks project templates for pro (single user)', () => {
    expect(isPlanFeatureAllowed('project_templates', 'pro', 'pro')).toBe(false);
  });
});

describe('Audit Logs Gate', () => {
  it('allows audit logs for team plan', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'team', 'team')).toBe(true);
  });

  it('allows audit logs for enterprise', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks audit logs for pro (single user)', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'pro', 'pro')).toBe(false);
  });
});

describe('Team Analytics Gate', () => {
  it('allows team analytics for team plan (all team plans get analytics)', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'team', 'team')).toBe(true);
  });

  it('allows team analytics for enterprise', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks team analytics for pro (single user)', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'pro', 'pro')).toBe(false);
  });

  it('blocks team analytics for free', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'free', 'free')).toBe(false);
  });
});

describe('Feature gating with invalid license', () => {
  it('blocks all plan features when valid=false', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team', 'team', false)).toBe(false);
    expect(isPlanFeatureAllowed('project_templates', 'team', 'team', false)).toBe(false);
    expect(isPlanFeatureAllowed('audit_logs', 'team', 'team', false)).toBe(false);
    expect(isPlanFeatureAllowed('team_analytics', 'team', 'team', false)).toBe(false);
  });
});

describe('Tier-level gating (isFeatureAllowed)', () => {
  it('blocks all premium features for free tier', () => {
    expect(isFeatureAllowed('branded_widget', 'free')).toBe(false);
    expect(isFeatureAllowed('project_templates', 'free')).toBe(false);
    expect(isFeatureAllowed('audit_logs', 'free')).toBe(false);
    expect(isFeatureAllowed('team_analytics', 'free')).toBe(false);
  });

  it('blocks all premium features for pro tier (single user)', () => {
    expect(isFeatureAllowed('branded_widget', 'pro')).toBe(false);
    expect(isFeatureAllowed('project_templates', 'pro')).toBe(false);
    expect(isFeatureAllowed('audit_logs', 'pro')).toBe(false);
    expect(isFeatureAllowed('team_analytics', 'pro')).toBe(false);
  });

  it('allows all team features for team tier', () => {
    expect(isFeatureAllowed('branded_widget', 'team')).toBe(true);
    expect(isFeatureAllowed('project_templates', 'team')).toBe(true);
    expect(isFeatureAllowed('audit_logs', 'team')).toBe(true);
    expect(isFeatureAllowed('team_analytics', 'team')).toBe(true);
  });

  it('allows all premium features for enterprise tier', () => {
    expect(isFeatureAllowed('branded_widget', 'enterprise')).toBe(true);
    expect(isFeatureAllowed('project_templates', 'enterprise')).toBe(true);
    expect(isFeatureAllowed('audit_logs', 'enterprise')).toBe(true);
    expect(isFeatureAllowed('team_analytics', 'enterprise')).toBe(true);
  });
});

describe('getFeatureGating includes all premium features', () => {
  it('enterprise gating has all premium features enabled', () => {
    const gating = getFeatureGating('enterprise');
    expect(gating.branded_widget).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
  });

  it('free gating has all premium features disabled', () => {
    const gating = getFeatureGating('free');
    expect(gating.branded_widget).toBe(false);
    expect(gating.project_templates).toBe(false);
    expect(gating.audit_logs).toBe(false);
    expect(gating.team_analytics).toBe(false);
  });

  it('team gating has all team features enabled including analytics', () => {
    const gating = getFeatureGating('team');
    expect(gating.branded_widget).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
    expect(gating.drafts).toBe(true);
  });

  it('team plan gating enables all team features', () => {
    const gating = getFeatureGating('team', 'team');
    expect(gating.branded_widget).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
  });
});
