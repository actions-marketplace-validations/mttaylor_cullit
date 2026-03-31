import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';

// Mock auth module
const mockResolveUser = vi.fn();
const mockGetOrg = vi.fn();
const mockGenerateApiKey = vi.fn().mockReturnValue('clt_new_rotated_key');

vi.mock('../src/auth.js', () => ({
  resolveUser: (...args: unknown[]) => mockResolveUser(...args),
  getOrg: (...args: unknown[]) => mockGetOrg(...args),
  generateApiKey: (...args: unknown[]) => mockGenerateApiKey(...args),
}));

// Mock db module
const mockDbGetTeamApiKeys = vi.fn();
const mockDbCreateTeamApiKey = vi.fn();
const mockDbUpdateTeamApiKeyAssignment = vi.fn();
const mockDbUpdateTeamApiKeyLabel = vi.fn();
const mockDbRevokeTeamApiKey = vi.fn();
const mockDbRotateTeamApiKey = vi.fn();
const mockDbGetActiveTeamApiKeyCount = vi.fn();

vi.mock('../src/db.js', () => ({
  dbGetTeamApiKeys: (...args: unknown[]) => mockDbGetTeamApiKeys(...args),
  dbCreateTeamApiKey: (...args: unknown[]) => mockDbCreateTeamApiKey(...args),
  dbUpdateTeamApiKeyAssignment: (...args: unknown[]) => mockDbUpdateTeamApiKeyAssignment(...args),
  dbUpdateTeamApiKeyLabel: (...args: unknown[]) => mockDbUpdateTeamApiKeyLabel(...args),
  dbRevokeTeamApiKey: (...args: unknown[]) => mockDbRevokeTeamApiKey(...args),
  dbRotateTeamApiKey: (...args: unknown[]) => mockDbRotateTeamApiKey(...args),
  dbGetActiveTeamApiKeyCount: (...args: unknown[]) => mockDbGetActiveTeamApiKeyCount(...args),
}));

// Mock email module
const mockSendTeamApiKey = vi.fn().mockResolvedValue(true);

vi.mock('../src/email.js', () => ({
  sendTeamApiKey: (...args: unknown[]) => mockSendTeamApiKey(...args),
}));

// Mock logger
vi.mock('../src/logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  handleListTeamKeys,
  handleUpdateTeamKey,
  handleSendTeamKey,
  handleRevokeTeamKey,
  handleRotateTeamKey,
} from '../src/routes/team-keys.js';

// --- Helpers ---

function mockReq(body = '{}'): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]);
  return stream as unknown as IncomingMessage;
}

interface CapturedResponse { status: number; body: Record<string, unknown> }
let captured: CapturedResponse;

function mockRes(): ServerResponse {
  const res = {
    _corsOrigin: '',
    writeHead: vi.fn(),
    end: vi.fn().mockImplementation((payload: string) => {
      const call = (res.writeHead as ReturnType<typeof vi.fn>).mock.calls[
        (res.writeHead as ReturnType<typeof vi.fn>).mock.calls.length - 1
      ];
      captured = { status: call?.[0] ?? 0, body: JSON.parse(payload) };
    }),
  } as unknown as ServerResponse;
  return res;
}

const owner = { id: 'u1', login: 'owner', name: 'Owner', orgId: 'org1', role: 'owner', tier: 'team' };
const admin = { id: 'u2', login: 'admin', name: 'Admin', orgId: 'org1', role: 'admin', tier: 'team' };
const member = { id: 'u3', login: 'member', name: 'Member', orgId: 'org1', role: 'member', tier: 'team' };
const outsider = { id: 'u4', login: 'outsider', orgId: undefined, role: undefined, tier: 'free' };

const sampleKeys = [
  {
    id: 'k1', org_id: 'org1', api_key: 'clt_key_one_full', label: 'Seat 1',
    assigned_to_email: 'dev@co.com', assigned_to_name: 'Dev', assigned_at: new Date(),
    revoked_at: null, created_at: new Date(),
  },
  {
    id: 'k2', org_id: 'org1', api_key: 'clt_key_two_full', label: 'Seat 2',
    assigned_to_email: null, assigned_to_name: null, assigned_at: null,
    revoked_at: null, created_at: new Date(),
  },
  {
    id: 'k3', org_id: 'org1', api_key: 'clt_key_revoked', label: 'Seat 3',
    assigned_to_email: 'old@co.com', assigned_to_name: 'Old', assigned_at: new Date(),
    revoked_at: new Date(), created_at: new Date(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockDbGetTeamApiKeys.mockResolvedValue(sampleKeys);
  mockGetOrg.mockResolvedValue({ id: 'org1', name: 'Test Org' });
});

// --- handleListTeamKeys ---

describe('handleListTeamKeys', () => {
  it('returns 401 if not authenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleListTeamKeys(mockReq(), mockRes());
    expect(captured.status).toBe(401);
  });

  it('returns 403 if user has no org', async () => {
    mockResolveUser.mockResolvedValue(outsider);
    await handleListTeamKeys(mockReq(), mockRes());
    expect(captured.status).toBe(403);
  });

  it('returns full keys for owner', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleListTeamKeys(mockReq(), mockRes());
    expect(captured.status).toBe(200);
    const keys = captured.body.keys as Array<{ apiKey: string }>;
    expect(keys).toHaveLength(3);
    expect(keys[0].apiKey).toBe('clt_key_one_full');
    expect(keys[1].apiKey).toBe('clt_key_two_full');
  });

  it('returns full keys for admin', async () => {
    mockResolveUser.mockResolvedValue(admin);
    await handleListTeamKeys(mockReq(), mockRes());
    expect(captured.status).toBe(200);
    const keys = captured.body.keys as Array<{ apiKey: string }>;
    expect(keys[0].apiKey).toBe('clt_key_one_full');
  });

  it('returns masked keys for member (non-admin)', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleListTeamKeys(mockReq(), mockRes());
    expect(captured.status).toBe(200);
    const keys = captured.body.keys as Array<{ apiKey: string }>;
    expect(keys[0].apiKey).toBe('clt_key_...');
    expect(keys[0].apiKey).not.toBe('clt_key_one_full');
  });

  it('returns correct field mapping from snake_case to camelCase', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleListTeamKeys(mockReq(), mockRes());
    const keys = captured.body.keys as Array<Record<string, unknown>>;
    expect(keys[0]).toHaveProperty('assignedToEmail', 'dev@co.com');
    expect(keys[0]).toHaveProperty('assignedToName', 'Dev');
    expect(keys[0]).toHaveProperty('revokedAt', null);
    expect(keys[2]).toHaveProperty('revokedAt');
    expect(keys[2].revokedAt).not.toBeNull();
  });
});

// --- handleUpdateTeamKey ---

describe('handleUpdateTeamKey', () => {
  it('returns 401 if not authenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleUpdateTeamKey(mockReq('{}'), mockRes(), 'k1');
    expect(captured.status).toBe(401);
  });

  it('returns 403 if user is member (not admin/owner)', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleUpdateTeamKey(mockReq('{}'), mockRes(), 'k1');
    expect(captured.status).toBe(403);
  });

  it('updates label for owner', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockDbUpdateTeamApiKeyLabel.mockResolvedValue({ id: 'k1' });
    await handleUpdateTeamKey(mockReq('{"label":"Frontend Dev"}'), mockRes(), 'k1');
    expect(captured.status).toBe(200);
    expect(mockDbUpdateTeamApiKeyLabel).toHaveBeenCalledWith('k1', 'org1', 'Frontend Dev');
  });

  it('rejects label over 64 characters', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleUpdateTeamKey(mockReq(`{"label":"${'a'.repeat(65)}"}`), mockRes(), 'k1');
    expect(captured.status).toBe(400);
    expect(captured.body.error).toContain('64');
  });

  it('updates assignment with valid email', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockDbUpdateTeamApiKeyAssignment.mockResolvedValue({ id: 'k1' });
    await handleUpdateTeamKey(
      mockReq('{"assignedToEmail":"dev@example.com","assignedToName":"Dev"}'),
      mockRes(), 'k1',
    );
    expect(captured.status).toBe(200);
    expect(mockDbUpdateTeamApiKeyAssignment).toHaveBeenCalledWith('k1', 'org1', 'dev@example.com', 'Dev');
  });

  it('rejects invalid email format', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleUpdateTeamKey(mockReq('{"assignedToEmail":"not-an-email"}'), mockRes(), 'k1');
    expect(captured.status).toBe(400);
    expect(captured.body.error).toContain('email');
  });

  it('rejects "a@b" as invalid email (no TLD)', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleUpdateTeamKey(mockReq('{"assignedToEmail":"a@b"}'), mockRes(), 'k1');
    expect(captured.status).toBe(400);
  });

  it('returns 404 for non-existent key', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockDbUpdateTeamApiKeyLabel.mockResolvedValue(null);
    await handleUpdateTeamKey(mockReq('{"label":"Test"}'), mockRes(), 'k999');
    expect(captured.status).toBe(404);
  });
});

// --- handleSendTeamKey ---

describe('handleSendTeamKey', () => {
  it('returns 401 if not authenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleSendTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(401);
  });

  it('returns 403 if user is member', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleSendTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(403);
  });

  it('sends email to assigned recipient', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleSendTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(200);
    expect(captured.body.sent).toBe(true);
    expect(mockSendTeamApiKey).toHaveBeenCalledWith(
      'dev@co.com', 'Dev', 'Test Org', 'Owner', 'Seat 1',
    );
  });

  it('returns 400 if key has no assigned email', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleSendTeamKey(mockReq(), mockRes(), 'k2');
    expect(captured.status).toBe(400);
    expect(captured.body.error).toContain('email');
  });

  it('returns 400 if key is revoked', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleSendTeamKey(mockReq(), mockRes(), 'k3');
    expect(captured.status).toBe(400);
    expect(captured.body.error).toContain('revoked');
  });

  it('returns 404 for non-existent key', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleSendTeamKey(mockReq(), mockRes(), 'k999');
    expect(captured.status).toBe(404);
  });
});

// --- handleRevokeTeamKey ---

describe('handleRevokeTeamKey', () => {
  it('returns 401 if not authenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleRevokeTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(401);
  });

  it('returns 403 if user is member', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleRevokeTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(403);
  });

  it('revokes key for owner', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockDbRevokeTeamApiKey.mockResolvedValue(true);
    await handleRevokeTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(200);
    expect(captured.body.revoked).toBe(true);
    expect(mockDbRevokeTeamApiKey).toHaveBeenCalledWith('k1', 'org1');
  });

  it('revokes key for admin', async () => {
    mockResolveUser.mockResolvedValue(admin);
    mockDbRevokeTeamApiKey.mockResolvedValue(true);
    await handleRevokeTeamKey(mockReq(), mockRes(), 'k2');
    expect(captured.status).toBe(200);
  });

  it('returns 404 for non-existent or already revoked key', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockDbRevokeTeamApiKey.mockResolvedValue(false);
    await handleRevokeTeamKey(mockReq(), mockRes(), 'k999');
    expect(captured.status).toBe(404);
  });
});

// --- handleRotateTeamKey ---

describe('handleRotateTeamKey', () => {
  it('returns 401 if not authenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleRotateTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(401);
  });

  it('returns 403 if user is member', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleRotateTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(403);
  });

  it('rotates key and returns new value for owner', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockDbRotateTeamApiKey.mockResolvedValue({ id: 'k1', api_key: 'clt_new_rotated_key' });
    await handleRotateTeamKey(mockReq(), mockRes(), 'k1');
    expect(captured.status).toBe(200);
    expect(captured.body.apiKey).toBe('clt_new_rotated_key');
    expect(mockDbRotateTeamApiKey).toHaveBeenCalledWith('k1', 'org1', 'clt_new_rotated_key');
  });

  it('returns 404 for non-existent or revoked key', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockDbRotateTeamApiKey.mockResolvedValue(null);
    await handleRotateTeamKey(mockReq(), mockRes(), 'k999');
    expect(captured.status).toBe(404);
  });
});
