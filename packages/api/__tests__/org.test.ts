import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';

// Mock auth module
const mockResolveUser = vi.fn();
const mockGetUser = vi.fn();
const mockGetOrg = vi.fn();
const mockCreateOrg = vi.fn();
const mockAddOrgMember = vi.fn();
const mockRemoveOrgMember = vi.fn();
const mockGetOrgMembers = vi.fn();
const mockGetEffectiveTier = vi.fn();

vi.mock('../src/auth.js', () => ({
  resolveUser: (...args: unknown[]) => mockResolveUser(...args),
  getUser: (...args: unknown[]) => mockGetUser(...args),
  getOrg: (...args: unknown[]) => mockGetOrg(...args),
  createOrg: (...args: unknown[]) => mockCreateOrg(...args),
  addOrgMember: (...args: unknown[]) => mockAddOrgMember(...args),
  removeOrgMember: (...args: unknown[]) => mockRemoveOrgMember(...args),
  getOrgMembers: (...args: unknown[]) => mockGetOrgMembers(...args),
  getEffectiveTier: (...args: unknown[]) => mockGetEffectiveTier(...args),
}));

// Mock store module
const mockGetUsageStats = vi.fn().mockResolvedValue({ totalGenerations: 0, totalChanges: 0 });
const mockGetMonthlyGenerationCount = vi.fn().mockResolvedValue(0);

vi.mock('../src/store.js', () => ({
  getUsageStats: (...args: unknown[]) => mockGetUsageStats(...args),
  getMonthlyGenerationCount: (...args: unknown[]) => mockGetMonthlyGenerationCount(...args),
}));

// Mock db module
const mockDbCreateOrgInvite = vi.fn();
const mockDbListOrgInvites = vi.fn();
const mockDbDeleteOrgInvite = vi.fn();
const mockDbUpdateOrgMemberRole = vi.fn();

vi.mock('../src/db.js', () => ({
  dbCreateOrgInvite: (...args: unknown[]) => mockDbCreateOrgInvite(...args),
  dbListOrgInvites: (...args: unknown[]) => mockDbListOrgInvites(...args),
  dbDeleteOrgInvite: (...args: unknown[]) => mockDbDeleteOrgInvite(...args),
  dbUpdateOrgMemberRole: (...args: unknown[]) => mockDbUpdateOrgMemberRole(...args),
}));

import {
  handleGetOrg, handleCreateOrg, handleOrgInvite, handleOrgRemoveMember,
  handleCreateOrgInvite, handleListOrgInvites, handleDeleteOrgInvite,
  handleUpdateOrgMemberRole, handleGetOrgUsage,
} from '../src/routes/org.js';

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
      // Intercept json() calls
      const call = (res.writeHead as ReturnType<typeof vi.fn>).mock.calls[(res.writeHead as ReturnType<typeof vi.fn>).mock.calls.length - 1];
      captured = { status: call?.[0] ?? 0, body: JSON.parse(payload) };
    }),
  } as unknown as ServerResponse;
  return res;
}

const owner = { id: 'u1', login: 'owner', orgId: 'org1', role: 'owner', tier: 'team' };
const admin = { id: 'u2', login: 'admin', orgId: 'org1', role: 'admin', tier: 'team' };
const member = { id: 'u3', login: 'member', orgId: 'org1', role: 'member', tier: 'team' };
const outsider = { id: 'u4', login: 'outsider', orgId: undefined, role: undefined, tier: 'free' };
const teamOutsider = { id: 'u5', login: 'teamout', orgId: undefined, role: undefined, tier: 'team' };

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Auth boundary tests ---

describe('Org Routes — Authentication', () => {
  it('handleGetOrg returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleGetOrg(mockReq(), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleCreateOrg returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleCreateOrg(mockReq('{"name":"test"}'), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleOrgInvite returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleOrgInvite(mockReq('{"userId":"u5"}'), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleOrgRemoveMember returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleOrgRemoveMember(mockReq('{"userId":"u5"}'), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleGetOrgUsage returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleGetOrgUsage(mockReq(), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleCreateOrgInvite returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleCreateOrgInvite(mockReq('{"email":"a@b.com"}'), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleListOrgInvites returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleListOrgInvites(mockReq(), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleDeleteOrgInvite returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleDeleteOrgInvite(mockReq(), mockRes(), 'inv1');
    expect(captured.status).toBe(401);
  });

  it('handleUpdateOrgMemberRole returns 401 for unauthenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleUpdateOrgMemberRole(mockReq('{"role":"admin"}'), mockRes(), 'u3');
    expect(captured.status).toBe(401);
  });
});

// --- Role authorization tests ---

describe('Org Routes — Role Authorization', () => {
  // Member (non-admin, non-owner) should be blocked from admin actions
  it('handleOrgInvite returns 403 for regular member', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleOrgInvite(mockReq('{"userId":"u5"}'), mockRes());
    expect(captured.status).toBe(403);
  });

  it('handleOrgRemoveMember returns 403 for regular member', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleOrgRemoveMember(mockReq('{"userId":"u5"}'), mockRes());
    expect(captured.status).toBe(403);
  });

  it('handleCreateOrgInvite returns 403 for regular member', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleCreateOrgInvite(mockReq('{"email":"a@b.com"}'), mockRes());
    expect(captured.status).toBe(403);
  });

  it('handleListOrgInvites returns 403 for regular member', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleListOrgInvites(mockReq(), mockRes());
    expect(captured.status).toBe(403);
  });

  it('handleDeleteOrgInvite returns 403 for regular member', async () => {
    mockResolveUser.mockResolvedValue(member);
    await handleDeleteOrgInvite(mockReq(), mockRes(), 'inv1');
    expect(captured.status).toBe(403);
  });

  // Owner-only operations
  it('handleUpdateOrgMemberRole returns 403 for admin (not owner)', async () => {
    mockResolveUser.mockResolvedValue(admin);
    await handleUpdateOrgMemberRole(mockReq('{"role":"admin"}'), mockRes(), 'u3');
    expect(captured.status).toBe(403);
  });

  // Admin granting admin role is blocked (owner-only privilege)
  it('handleOrgInvite blocks admin from granting admin role', async () => {
    mockResolveUser.mockResolvedValue(admin);
    mockGetUser.mockResolvedValue({ id: 'u5', login: 'new', orgId: undefined });
    await handleOrgInvite(mockReq('{"userId":"u5","role":"admin"}'), mockRes());
    expect(captured.status).toBe(403);
    expect(captured.body.error).toContain('owner');
  });

  it('handleCreateOrgInvite blocks admin from creating admin invites', async () => {
    mockResolveUser.mockResolvedValue(admin);
    await handleCreateOrgInvite(mockReq('{"email":"a@b.com","role":"admin"}'), mockRes());
    expect(captured.status).toBe(403);
    expect(captured.body.error).toContain('owner');
  });

  // Outsider (no org) should be blocked from org operations
  it('handleOrgInvite returns 403 for user not in any org', async () => {
    mockResolveUser.mockResolvedValue(outsider);
    await handleOrgInvite(mockReq('{"userId":"u5"}'), mockRes());
    expect(captured.status).toBe(403);
  });

  it('handleOrgRemoveMember returns 403 for user not in any org', async () => {
    mockResolveUser.mockResolvedValue(outsider);
    await handleOrgRemoveMember(mockReq('{"userId":"u5"}'), mockRes());
    expect(captured.status).toBe(403);
  });
});

// --- Cross-org boundary tests ---

describe('Org Routes — Cross-Org Boundaries', () => {
  it('handleGetOrg returns null for user with no org', async () => {
    mockResolveUser.mockResolvedValue(outsider);
    await handleGetOrg(mockReq(), mockRes());
    expect(captured.status).toBe(200);
    expect(captured.body.org).toBeNull();
  });

  it('handleGetOrgUsage returns null usage for user with no org', async () => {
    mockResolveUser.mockResolvedValue(outsider);
    await handleGetOrgUsage(mockReq(), mockRes());
    expect(captured.status).toBe(200);
    expect(captured.body.usage).toBeNull();
  });

  it('handleCreateOrg returns 403 for free-tier user', async () => {
    mockResolveUser.mockResolvedValue(outsider);
    mockGetEffectiveTier.mockReturnValue('free');
    await handleCreateOrg(mockReq('{"name":"test org"}'), mockRes());
    expect(captured.status).toBe(403);
    expect(captured.body.error).toContain('Team plan required');
  });

  it('handleCreateOrg returns 409 for user already in an org', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockGetEffectiveTier.mockReturnValue('team');
    await handleCreateOrg(mockReq('{"name":"new org"}'), mockRes());
    expect(captured.status).toBe(409);
    expect(captured.body.error).toContain('Already');
  });
});

// --- Self-modification guards ---

describe('Org Routes — Self-Modification Guards', () => {
  it('handleUpdateOrgMemberRole blocks owner from changing own role', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleUpdateOrgMemberRole(mockReq('{"role":"member"}'), mockRes(), 'u1');
    expect(captured.status).toBe(409);
    expect(captured.body.error).toContain('own role');
  });
});

// --- Input validation ---

describe('Org Routes — Input Validation', () => {
  it('handleCreateOrg rejects name shorter than 2 chars', async () => {
    mockResolveUser.mockResolvedValue(teamOutsider);
    mockGetEffectiveTier.mockReturnValue('team');
    await handleCreateOrg(mockReq('{"name":"a"}'), mockRes());
    expect(captured.status).toBe(400);
  });

  it('handleCreateOrg rejects name longer than 64 chars', async () => {
    mockResolveUser.mockResolvedValue(teamOutsider);
    mockGetEffectiveTier.mockReturnValue('team');
    const longName = 'x'.repeat(65);
    await handleCreateOrg(mockReq(JSON.stringify({ name: longName })), mockRes());
    expect(captured.status).toBe(400);
  });

  it('handleCreateOrg rejects invalid JSON', async () => {
    mockResolveUser.mockResolvedValue(teamOutsider);
    mockGetEffectiveTier.mockReturnValue('team');
    await handleCreateOrg(mockReq('not json'), mockRes());
    expect(captured.status).toBe(400);
  });

  it('handleOrgInvite rejects missing userId', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleOrgInvite(mockReq('{}'), mockRes());
    expect(captured.status).toBe(400);
  });

  it('handleOrgRemoveMember rejects missing userId', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleOrgRemoveMember(mockReq('{}'), mockRes());
    expect(captured.status).toBe(400);
  });

  it('handleUpdateOrgMemberRole rejects invalid role', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleUpdateOrgMemberRole(mockReq('{"role":"superadmin"}'), mockRes(), 'u3');
    expect(captured.status).toBe(400);
  });

  it('handleCreateOrgInvite rejects invalid email', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleCreateOrgInvite(mockReq('{"email":"notanemail"}'), mockRes());
    expect(captured.status).toBe(400);
  });

  it('handleCreateOrgInvite rejects missing email', async () => {
    mockResolveUser.mockResolvedValue(owner);
    await handleCreateOrgInvite(mockReq('{}'), mockRes());
    expect(captured.status).toBe(400);
  });
});

// --- Happy paths (admin/owner succeed) ---

describe('Org Routes — Happy Paths', () => {
  it('handleOrgInvite succeeds for owner with member role', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockGetUser.mockResolvedValue({ id: 'u5', login: 'new' });
    mockAddOrgMember.mockResolvedValue(true);
    await handleOrgInvite(mockReq('{"userId":"u5","role":"member"}'), mockRes());
    expect(captured.status).toBe(200);
    expect(captured.body.ok).toBe(true);
  });

  it('handleOrgInvite succeeds for admin with member role', async () => {
    mockResolveUser.mockResolvedValue(admin);
    mockGetUser.mockResolvedValue({ id: 'u5', login: 'new' });
    mockAddOrgMember.mockResolvedValue(true);
    await handleOrgInvite(mockReq('{"userId":"u5","role":"member"}'), mockRes());
    expect(captured.status).toBe(200);
  });

  it('handleOrgInvite allows owner to grant admin role', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockGetUser.mockResolvedValue({ id: 'u5', login: 'new' });
    mockAddOrgMember.mockResolvedValue(true);
    await handleOrgInvite(mockReq('{"userId":"u5","role":"admin"}'), mockRes());
    expect(captured.status).toBe(200);
  });

  it('handleOrgRemoveMember succeeds for owner', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockRemoveOrgMember.mockResolvedValue(true);
    await handleOrgRemoveMember(mockReq('{"userId":"u3"}'), mockRes());
    expect(captured.status).toBe(200);
  });

  it('handleUpdateOrgMemberRole succeeds for owner changing another member', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockDbUpdateOrgMemberRole.mockResolvedValue(true);
    await handleUpdateOrgMemberRole(mockReq('{"role":"admin"}'), mockRes(), 'u3');
    expect(captured.status).toBe(200);
    expect(captured.body.role).toBe('admin');
  });

  it('handleOrgInvite returns 404 for unknown user', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockGetUser.mockResolvedValue(null);
    await handleOrgInvite(mockReq('{"userId":"unknown"}'), mockRes());
    expect(captured.status).toBe(404);
  });

  it('handleOrgInvite returns 409 when org is full', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockGetUser.mockResolvedValue({ id: 'u5', login: 'new' });
    mockAddOrgMember.mockResolvedValue(false);
    await handleOrgInvite(mockReq('{"userId":"u5"}'), mockRes());
    expect(captured.status).toBe(409);
  });

  it('handleOrgRemoveMember returns 409 when removing owner', async () => {
    mockResolveUser.mockResolvedValue(owner);
    mockRemoveOrgMember.mockResolvedValue(false);
    await handleOrgRemoveMember(mockReq('{"userId":"u1"}'), mockRes());
    expect(captured.status).toBe(409);
  });
});
