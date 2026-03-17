import { describe, it, expect } from 'vitest';
import { resolveActionRefs } from './action-refs';

describe('resolveActionRefs', () => {
  it('preserves explicit refs', () => {
    expect(resolveActionRefs('v1.0.0', 'v1.1.0', ['v1.1.0', 'v1.0.0'])).toEqual({
      from: 'v1.0.0',
      to: 'v1.1.0',
      autoDetected: false,
    });
  });

  it('uses the latest tag when from is omitted and to defaults to HEAD', () => {
    expect(resolveActionRefs('', undefined, ['v1.2.0', 'v1.1.0'])).toEqual({
      from: 'v1.2.0',
      to: 'HEAD',
      autoDetected: true,
    });
  });

  it('uses the previous tag when to is an explicit tag', () => {
    expect(resolveActionRefs('', 'v1.2.0', ['v1.3.0', 'v1.2.0', 'v1.1.0'])).toEqual({
      from: 'v1.1.0',
      to: 'v1.2.0',
      autoDetected: true,
    });
  });

  it('falls back to the latest tag when to is not itself tagged', () => {
    expect(resolveActionRefs('', 'feature-branch', ['v1.2.0', 'v1.1.0'])).toEqual({
      from: 'v1.2.0',
      to: 'feature-branch',
      autoDetected: true,
    });
  });

  it('throws when there are no tags to infer from', () => {
    expect(() => resolveActionRefs('', undefined, [])).toThrow(/no tags were found/i);
  });
});