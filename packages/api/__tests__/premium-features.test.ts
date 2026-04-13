import { describe, it, expect } from 'vitest';
import { isPlanFeatureAllowed, isFeatureAllowed, getFeatureGating } from '@cullit/core';

describe('Branded Widget Gate', () => {
  it('allows branded widget for paid plan', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'paid', 'paid')).toBe(true);
  });

  it('allows branded widget for enterprise', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks branded widget for free', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'free', 'free')).toBe(false);
  });
});

describe('Project Templates Gate', () => {
  it('allows project templates for paid plan', () => {
    expect(isPlanFeatureAllowed('project_templates', 'paid', 'paid')).toBe(true);
  });

  it('allows project templates for enterprise', () => {
    expect(isPlanFeatureAllowed('project_templates', 'enterprise', 'enterprise')).toBe(true);
  });
});

describe('Audit Logs Gate', () => {
  it('allows audit logs for paid plan', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'paid', 'paid')).toBe(true);
  });

  it('allows audit logs for enterprise', () => {
    expect(isPlanFeatureAllowed('audit_logs', 'enterprise', 'enterprise')).toBe(true);
  });
});

describe('Team Analytics Gate', () => {
  it('allows team analytics for paid plan', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'paid', 'paid')).toBe(true);
  });

  it('allows team analytics for enterprise', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'enterprise', 'enterprise')).toBe(true);
  });

  it('blocks team analytics for free', () => {
    expect(isPlanFeatureAllowed('team_analytics', 'free', 'free')).toBe(false);
  });
});

describe('Feature gating with invalid license', () => {
  it('blocks all plan features when valid=false', () => {
    expect(isPlanFeatureAllowed('branded_widget', 'paid', 'paid', false)).toBe(false);
    expect(isPlanFeatureAllowed('project_templates', 'paid', 'paid', false)).toBe(false);
    expect(isPlanFeatureAllowed('audit_logs', 'paid', 'paid', false)).toBe(false);
    expect(isPlanFeatureAllowed('team_analytics', 'paid', 'paid', false)).toBe(false);
  });
});

describe('Tier-level gating (isFeatureAllowed)', () => {
  it('blocks all premium features for free tier', () => {
    expect(isFeatureAllowed('branded_widget', 'free')).toBe(false);
    expect(isFeatureAllowed('project_templates', 'free')).toBe(false);
    expect(isFeatureAllowed('audit_logs', 'free')).toBe(false);
    expect(isFeatureAllowed('team_analytics', 'free')).toBe(false);
  });

  it('allows all premium features for paid tier', () => {
    expect(isFeatureAllowed('branded_widget', 'paid')).toBe(true);
    expect(isFeatureAllowed('project_templates', 'paid')).toBe(true);
    expect(isFeatureAllowed('audit_logs', 'paid')).toBe(true);
    expect(isFeatureAllowed('team_analytics', 'paid')).toBe(true);
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

  it('paid gating has all features enabled except sso', () => {
    const gating = getFeatureGating('paid');
    expect(gating.branded_widget).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
    expect(gating.drafts).toBe(true);
  });

  it('paid plan gating enables all paid features', () => {
    const gating = getFeatureGating('paid', 'paid');
    expect(gating.branded_widget).toBe(true);
    expect(gating.project_templates).toBe(true);
    expect(gating.audit_logs).toBe(true);
    expect(gating.team_analytics).toBe(true);
  });
});
