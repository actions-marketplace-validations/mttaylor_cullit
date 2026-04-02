import { describe, it, expect } from 'vitest';
import { isPlanFeatureAllowed, isFeatureAllowed, getFeatureGating } from '@cullit/core';

describe('Branded Widget Gate', () => {
  it('blocks branded widget for team-5 plan', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team-5', 'team')).toBe(false);
  });

  it('blocks branded widget for team-10 plan', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team-10', 'team')).toBe(false);
  });

  it('allows branded widget for team-25 plan', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team-25', 'team')).toBe(true);
  });

  it('allows branded widget for enterprise', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks branded widget for pro', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'pro', 'pro')).toBe(false);
  });

  it('blocks branded widget for free', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'free', 'free')).toBe(false);
  });
});

describe('Project Templates Gate', () => {
  it('blocks project templates for team-5', () => {
    expect(isPlanFeatureAllowed('project_templates', 'team-5', 'team')).toBe(false);
  });

  it('blocks project templates for team-10', () => {
    expect(isPlanFeatureAllowed('project_templates', 'team-10', 'team')).toBe(false);
  });

  it('allows project templates for team-25', () => {
    expect(isPlanFeatureAllowed('project_templates', 'team-25', 'team')).toBe(true);
  });

  it('allows project templates for enterprise', () => {
    expect(isPlanFeatureAllowed('project_templates', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks project templates for pro', () => {
    expect(isPlanFeatureAllowed('project_templates', 'pro', 'pro')).toBe(false);
  });
});

describe('Audit Logs Gate', () => {
  it('blocks audit logs for team-5', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'team-5', 'team')).toBe(false);
  });

  it('blocks audit logs for team-10', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'team-10', 'team')).toBe(false);
  });

  it('allows audit logs for team-25', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'team-25', 'team')).toBe(true);
  });

  it('allows audit logs for enterprise', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks audit logs for pro', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'pro', 'pro')).toBe(false);
  });
});

describe('Team Analytics Gate', () => {
  it('blocks team analytics for team-5', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'team-5', 'team')).toBe(false);
  });

  it('blocks team analytics for team-10', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'team-10', 'team')).toBe(false);
  });

  it('allows team analytics for team-25', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'team-25', 'team')).toBe(true);
  });

  it('allows team analytics for enterprise', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks team analytics for pro', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'pro', 'pro')).toBe(false);
  });

  it('blocks team analytics for free', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'free', 'free')).toBe(false);
  });
});

describe('Feature gating with invalid license', () => {
  it('blocks all plan features when valid=false', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'team-25', 'team', false)).toBe(false);
    expect(isPlanFeatureAllowed('project_templates', 'team-25', 'team', false)).toBe(false);
    expect(isPlanFeatureAllowed('audit_logs', 'team-25', 'team', false)).toBe(false);
    expect(isPlanFeatureAllowed('team_analytics', 'team-25', 'team', false)).toBe(false);
  });
});

describe('Tier-level gating (isFeatureAllowed)', () => {
  const features = ['branded_widget', 'project_templates', 'audit_logs', 'team_analytics'] as const;

  it('blocks all 4 premium features for free tier', () => {
    for (const f of features) {
      expect(isFeatureAllowed(f, 'free')).toBe(false);
    }
  });

  it('blocks all 4 premium features for pro tier', () => {
    for (const f of features) {
      expect(isFeatureAllowed(f, 'pro')).toBe(false);
    }
  });

  it('blocks all 4 premium features for team tier (tier-level requires enterprise)', () => {
    for (const f of features) {
      expect(isFeatureAllowed(f, 'team')).toBe(false);
    }
  });

  it('allows all 4 premium features for enterprise tier', () => {
    for (const f of features) {
      expect(isFeatureAllowed(f, 'enterprise')).toBe(true);
    }
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

  it('team gating has premium features disabled (plan-level only)', () => {
    const gating = getFeatureGating('team');
    expect(gating.branded_widget).toBe(false);
    expect(gating.project_templates).toBe(false);
    expect(gating.audit_logs).toBe(false);
    expect(gating.team_analytics).toBe(false);
  });

  it('team-25 plan enables premium features via plan param', () => {
    const gating = getFeatureGating('team', 'team-25');
    expect(gating.branded_widget).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
  });

  it('team-10 plan does NOT enable premium features', () => {
    const gating = getFeatureGating('team', 'team-10');
    expect(gating.branded_widget).toBe(false);
    expect(gating.project_templates).toBe(false);
    expect(gating.audit_logs).toBe(false);
    expect(gating.team_analytics).toBe(false);
  });

  it('team-5 plan does NOT enable premium features', () => {
    const gating = getFeatureGating('team', 'team-5');
    expect(gating.branded_widget).toBe(false);
    expect(gating.project_templates).toBe(false);
    expect(gating.audit_logs).toBe(false);
    expect(gating.team_analytics).toBe(false);
  });
});
