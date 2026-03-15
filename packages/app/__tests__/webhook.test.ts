import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

describe('GitHub App - verifySignature', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('verifies a valid HMAC-SHA256 signature', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-secret-123');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    // Fresh import to pick up env
    const mod = await import('../src/index');
    const payload = '{"action":"published"}';
    const expected = 'sha256=' + createHmac('sha256', 'test-secret-123').update(payload).digest('hex');

    expect(mod.verifySignature(payload, expected)).toBe(true);
  });

  it('rejects an invalid signature', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-secret-123');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const mod = await import('../src/index');
    expect(mod.verifySignature('payload', 'sha256=invalid')).toBe(false);
  });

  it('rejects when no signature provided', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'test-secret-123');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const mod = await import('../src/index');
    expect(mod.verifySignature('payload', undefined)).toBe(false);
  });

  it('rejects when no secret configured', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const mod = await import('../src/index');
    expect(mod.verifySignature('payload', 'sha256=anything')).toBe(false);
  });
});

describe('GitHub App - handleInstallation', () => {
  it('logs installation created events', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/index');

    mod.handleInstallation({
      action: 'created',
      installation: { account: { login: 'acme-corp' } },
      repositories: [
        { full_name: 'acme-corp/api' },
        { full_name: 'acme-corp/web' },
      ],
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('created'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('acme-corp'));
  });

  it('handles missing installation account gracefully', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/index');

    // Should not throw
    mod.handleInstallation({ action: 'deleted', installation: {} });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deleted'));
  });
});

describe('GitHub App - handleRelease', () => {
  it('skips non-published/created actions', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const mod = await import('../src/index');

    // editied action should be skipped (no error thrown)
    await mod.handleRelease({
      action: 'edited',
      release: { tag_name: 'v1.0.0' },
      repository: { owner: { login: 'test' }, name: 'repo' },
      installation: { id: 1 },
    });
  });

  it('skips when release/repository/installation missing', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const mod = await import('../src/index');

    // All of these should not throw
    await mod.handleRelease({});
    await mod.handleRelease({ release: null, repository: null, installation: null });
  });
});

describe('GitHub App - handlePush', () => {
  it('skips non-tag push refs', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const mod = await import('../src/index');

    // Branch push should be ignored silently
    await mod.handlePush({
      ref: 'refs/heads/main',
      repository: { owner: { login: 'test' }, name: 'repo' },
      installation: { id: 1 },
    });
  });

  it('skips when ref/repository/installation missing', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    vi.stubEnv('GITHUB_APP_ID', '');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');

    const mod = await import('../src/index');
    await mod.handlePush({});
  });
});
