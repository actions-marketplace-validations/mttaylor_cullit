import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';

// Mock auth module
const mockResolveUser = vi.fn();
const mockGetEffectiveTier = vi.fn();
const mockGetOrg = vi.fn();

vi.mock('../src/auth.js', () => ({
  resolveUser: (...args: unknown[]) => mockResolveUser(...args),
  getEffectiveTier: (...args: unknown[]) => mockGetEffectiveTier(...args),
  getOrg: (...args: unknown[]) => mockGetOrg(...args),
}));

// Mock db module
const mockDbCreateDraft = vi.fn();
const mockDbGetDraft = vi.fn();
const mockDbListDrafts = vi.fn();
const mockDbUpdateDraft = vi.fn();
const mockDbUpdateDraftStatus = vi.fn();
const mockDbDeleteDraft = vi.fn();
const mockDbCreateRevision = vi.fn();
const mockDbGetRevisions = vi.fn();
const mockDbGetRevisionCount = vi.fn();
const mockDbPublishRelease = vi.fn();
const mockDbPublishDraftWithRelease = vi.fn();

vi.mock('../src/db.js', () => ({
  dbCreateDraft: (...args: unknown[]) => mockDbCreateDraft(...args),
  dbGetDraft: (...args: unknown[]) => mockDbGetDraft(...args),
  dbListDrafts: (...args: unknown[]) => mockDbListDrafts(...args),
  dbUpdateDraft: (...args: unknown[]) => mockDbUpdateDraft(...args),
  dbUpdateDraftStatus: (...args: unknown[]) => mockDbUpdateDraftStatus(...args),
  dbDeleteDraft: (...args: unknown[]) => mockDbDeleteDraft(...args),
  dbCreateRevision: (...args: unknown[]) => mockDbCreateRevision(...args),
  dbGetRevisions: (...args: unknown[]) => mockDbGetRevisions(...args),
  dbGetRevisionCount: (...args: unknown[]) => mockDbGetRevisionCount(...args),
  dbPublishRelease: (...args: unknown[]) => mockDbPublishRelease(...args),
  dbPublishDraftWithRelease: (...args: unknown[]) => mockDbPublishDraftWithRelease(...args),
}));

// Mock logger (prevent console output in tests)
vi.mock('../src/logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  handleCreateDraft, handleListDrafts, handleGetDraft, handleUpdateDraft,
  handleDraftSubmit, handleDeleteDraft, handleDraftApprove, handleDraftPublish,
} from '../src/routes/drafts.js';

// --- Helpers ---

function mockReq(body = '{}', url = '/'): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]);
  (stream as unknown as Record<string, unknown>).url = url;
  return stream as unknown as IncomingMessage;
}

interface CapturedResponse { status: number; body: Record<string, unknown> }
let captured: CapturedResponse;

function mockRes(): ServerResponse {
  const res = {
    _corsOrigin: '',
    writeHead: vi.fn(),
    end: vi.fn().mockImplementation((payload: string) => {
      const call = (res.writeHead as ReturnType<typeof vi.fn>).mock.calls[(res.writeHead as ReturnType<typeof vi.fn>).mock.calls.length - 1];
      captured = { status: call?.[0] ?? 0, body: JSON.parse(payload) };
    }),
  } as unknown as ServerResponse;
  return res;
}

// Test users
const teamOwner = { id: 'u1', login: 'owner', orgId: 'org1', role: 'owner', tier: 'team' };
const teamAdmin = { id: 'u2', login: 'admin', orgId: 'org1', role: 'admin', tier: 'team' };
const teamMember = { id: 'u3', login: 'member', orgId: 'org1', role: 'member', tier: 'team' };
const freeUser = { id: 'u4', login: 'free', orgId: null, role: 'member', tier: 'free' };
const otherOrgUser = { id: 'u5', login: 'other', orgId: 'org2', role: 'owner', tier: 'team' };

// Sample draft
const sampleDraft = {
  id: 'draft1', project: 'myapp', version: '1.0.0', org_id: 'org1', user_id: 'u3',
  status: 'draft', formatted_md: '# v1.0.0', formatted_html: '<h1>v1.0.0</h1>',
  notes_json: '[]', created_by: 'u3',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEffectiveTier.mockImplementation((u: { tier?: string }) => u?.tier || 'free');
});

// --- Authentication ---

describe('Draft Routes — Authentication', () => {
  it('handleCreateDraft returns 401 when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleCreateDraft(mockReq('{"project":"test"}'), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleListDrafts returns 401 when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleListDrafts(mockReq(), mockRes());
    expect(captured.status).toBe(401);
  });

  it('handleGetDraft returns 401 when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleGetDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(401);
  });

  it('handleDraftSubmit returns 401 when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleDraftSubmit(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(401);
  });

  it('handleDraftApprove returns 401 when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleDraftApprove(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(401);
  });

  it('handleDraftPublish returns 401 when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleDraftPublish(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(401);
  });

  it('handleDeleteDraft returns 401 when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleDeleteDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(401);
  });

  it('handleUpdateDraft returns 401 when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await handleUpdateDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(401);
  });
});

// --- Tier gating ---

describe('Draft Routes — Tier gating', () => {
  it('handleCreateDraft returns 403 for free-tier user', async () => {
    mockResolveUser.mockResolvedValue(freeUser);
    await handleCreateDraft(mockReq('{"project":"test"}'), mockRes());
    expect(captured.status).toBe(403);
    expect(captured.body.upgrade).toBeDefined();
  });

  it('handleListDrafts returns 403 for free-tier user', async () => {
    mockResolveUser.mockResolvedValue(freeUser);
    await handleListDrafts(mockReq(), mockRes());
    expect(captured.status).toBe(403);
  });

  it('handleCreateDraft allows team-tier user', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbCreateDraft.mockResolvedValue({ id: 'new1', project: 'test' });
    await handleCreateDraft(mockReq(JSON.stringify({ project: 'test', formattedMd: '# Test' })), mockRes());
    expect(captured.status).toBe(201);
  });
});

// --- Create draft ---

describe('handleCreateDraft', () => {
  it('returns 400 for invalid JSON', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    await handleCreateDraft(mockReq('not json'), mockRes());
    expect(captured.status).toBe(400);
  });

  it('returns 400 when project is missing', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    await handleCreateDraft(mockReq(JSON.stringify({ formattedMd: '# Test' })), mockRes());
    expect(captured.status).toBe(400);
  });

  it('returns 400 for invalid project name (special chars)', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    await handleCreateDraft(mockReq(JSON.stringify({ project: 'bad project!' })), mockRes());
    expect(captured.status).toBe(400);
  });

  it('creates draft successfully', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    const created = { id: 'new1', project: 'myapp', version: '1.0.0' };
    mockDbCreateDraft.mockResolvedValue(created);

    await handleCreateDraft(mockReq(JSON.stringify({
      project: 'myapp', version: '1.0.0', formattedMd: '# Release', notes: ['fix bug'],
    })), mockRes());

    expect(captured.status).toBe(201);
    expect(captured.body.draft).toEqual(created);
    expect(mockDbCreateDraft).toHaveBeenCalledOnce();
  });
});

// --- List drafts ---

describe('handleListDrafts', () => {
  it('returns paginated results', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbListDrafts.mockResolvedValue({ drafts: [sampleDraft], total: 1 });

    await handleListDrafts(mockReq('{}', '/?limit=10&offset=0'), mockRes());
    expect(captured.status).toBe(200);
    expect(captured.body.drafts).toHaveLength(1);
    expect(captured.body.total).toBe(1);
  });

  it('returns 400 for invalid status filter', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    await handleListDrafts(mockReq('{}', '/?status=bogus'), mockRes());
    expect(captured.status).toBe(400);
  });

  it('accepts valid status filter', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbListDrafts.mockResolvedValue({ drafts: [], total: 0 });

    await handleListDrafts(mockReq('{}', '/?status=submitted'), mockRes());
    expect(captured.status).toBe(200);
    expect(mockDbListDrafts).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted' }));
  });
});

// --- Get draft ---

describe('handleGetDraft', () => {
  it('returns 404 when draft does not exist', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbGetDraft.mockResolvedValue(null);
    await handleGetDraft(mockReq(), mockRes(), 'nonexistent');
    expect(captured.status).toBe(404);
  });

  it('returns 403 when user has no access', async () => {
    mockResolveUser.mockResolvedValue(otherOrgUser);
    mockDbGetDraft.mockResolvedValue(sampleDraft);
    await handleGetDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(403);
  });

  it('returns draft with revisions for authorized user', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbGetDraft.mockResolvedValue(sampleDraft);
    mockDbGetRevisions.mockResolvedValue([]);
    await handleGetDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
    expect(captured.body.draft).toEqual(sampleDraft);
    expect(captured.body.revisions).toEqual([]);
  });

  it('allows access when user is draft owner in a different org', async () => {
    const ownedDraft = { ...sampleDraft, user_id: 'u5', org_id: 'org2' };
    mockResolveUser.mockResolvedValue(otherOrgUser);
    mockDbGetDraft.mockResolvedValue(ownedDraft);
    mockDbGetRevisions.mockResolvedValue([]);
    await handleGetDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
  });
});

// --- Update draft ---

describe('handleUpdateDraft', () => {
  it('returns 404 when draft does not exist', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(null);
    await handleUpdateDraft(mockReq('{"version":"2.0.0"}'), mockRes(), 'nonexistent');
    expect(captured.status).toBe(404);
  });

  it('returns 403 for non-admin member of same org', async () => {
    // teamMember (role: member) trying to update draft they don't own
    const otherDraft = { ...sampleDraft, user_id: 'u1' }; // owned by u1, not u3
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbGetDraft.mockResolvedValue(otherDraft);
    await handleUpdateDraft(mockReq('{"version":"2.0.0"}'), mockRes(), 'draft1');
    expect(captured.status).toBe(403);
  });

  it('returns 409 when draft is published', async () => {
    const published = { ...sampleDraft, status: 'published', user_id: 'u1' };
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(published);
    await handleUpdateDraft(mockReq('{"version":"2.0.0"}'), mockRes(), 'draft1');
    expect(captured.status).toBe(409);
  });

  it('creates revision and updates draft on success', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue({ ...sampleDraft, user_id: 'u1' });
    mockDbGetRevisionCount.mockResolvedValue(0);
    mockDbCreateRevision.mockResolvedValue({});
    const updatedDraft = { ...sampleDraft, version: '2.0.0' };
    mockDbUpdateDraft.mockResolvedValue(updatedDraft);

    await handleUpdateDraft(mockReq(JSON.stringify({ version: '2.0.0' })), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
    expect(mockDbCreateRevision).toHaveBeenCalledOnce();
    expect(mockDbUpdateDraft).toHaveBeenCalledOnce();
  });

  it('returns 400 for invalid JSON', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue({ ...sampleDraft, user_id: 'u1' });
    await handleUpdateDraft(mockReq('not json'), mockRes(), 'draft1');
    expect(captured.status).toBe(400);
  });
});

// --- Submit draft ---

describe('handleDraftSubmit', () => {
  it('returns 404 when draft does not exist', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbGetDraft.mockResolvedValue(null);
    await handleDraftSubmit(mockReq(), mockRes(), 'nonexistent');
    expect(captured.status).toBe(404);
  });

  it('returns 403 when user has no access', async () => {
    mockResolveUser.mockResolvedValue(otherOrgUser);
    mockDbGetDraft.mockResolvedValue(sampleDraft);
    await handleDraftSubmit(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(403);
  });

  it('returns 409 when draft is not in draft status', async () => {
    const submitted = { ...sampleDraft, status: 'submitted' };
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbGetDraft.mockResolvedValue(submitted);
    await handleDraftSubmit(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(409);
  });

  it('transitions draft to submitted', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbGetDraft.mockResolvedValue(sampleDraft);
    const submitted = { ...sampleDraft, status: 'submitted' };
    mockDbUpdateDraftStatus.mockResolvedValue(submitted);
    await handleDraftSubmit(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
    expect(mockDbUpdateDraftStatus).toHaveBeenCalledWith('draft1', 'submitted');
  });
});

// --- Delete draft ---

describe('handleDeleteDraft', () => {
  it('returns 404 when draft does not exist', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(null);
    await handleDeleteDraft(mockReq(), mockRes(), 'nonexistent');
    expect(captured.status).toBe(404);
  });

  it('returns 403 for non-admin non-owner', async () => {
    const otherDraft = { ...sampleDraft, user_id: 'u1' };
    mockResolveUser.mockResolvedValue(teamMember);
    mockDbGetDraft.mockResolvedValue(otherDraft);
    await handleDeleteDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(403);
  });

  it('returns 409 when draft is published', async () => {
    const published = { ...sampleDraft, status: 'published', user_id: 'u1' };
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(published);
    await handleDeleteDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(409);
  });

  it('deletes draft successfully', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue({ ...sampleDraft, user_id: 'u1' });
    mockDbDeleteDraft.mockResolvedValue(true);
    await handleDeleteDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
    expect(captured.body.ok).toBe(true);
  });

  it('returns 404 when dbDeleteDraft returns false', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue({ ...sampleDraft, user_id: 'u1' });
    mockDbDeleteDraft.mockResolvedValue(false);
    await handleDeleteDraft(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(404);
  });
});

// --- Approve draft ---

describe('handleDraftApprove', () => {
  it('returns 403 for regular members (non-admin)', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    await handleDraftApprove(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(403);
  });

  it('returns 404 when draft does not exist', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(null);
    await handleDraftApprove(mockReq(), mockRes(), 'nonexistent');
    expect(captured.status).toBe(404);
  });

  it('returns 403 when draft belongs to different org', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    const otherOrgDraft = { ...sampleDraft, org_id: 'org2' };
    mockDbGetDraft.mockResolvedValue(otherOrgDraft);
    await handleDraftApprove(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(403);
  });

  it('returns 409 when draft is not in submitted status', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(sampleDraft); // status = 'draft'
    await handleDraftApprove(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(409);
  });

  it('approves submitted draft', async () => {
    const submitted = { ...sampleDraft, status: 'submitted' };
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(submitted);
    const approved = { ...submitted, status: 'approved' };
    mockDbUpdateDraftStatus.mockResolvedValue(approved);

    await handleDraftApprove(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
    expect(mockDbUpdateDraftStatus).toHaveBeenCalledWith('draft1', 'approved', 'u1');
  });

  it('allows admin to approve', async () => {
    const submitted = { ...sampleDraft, status: 'submitted' };
    mockResolveUser.mockResolvedValue(teamAdmin);
    mockDbGetDraft.mockResolvedValue(submitted);
    mockDbUpdateDraftStatus.mockResolvedValue({ ...submitted, status: 'approved' });

    await handleDraftApprove(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
  });
});

// --- Publish draft ---

describe('handleDraftPublish', () => {
  it('returns 403 for regular members', async () => {
    mockResolveUser.mockResolvedValue(teamMember);
    await handleDraftPublish(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(403);
  });

  it('returns 404 when draft does not exist', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(null);
    await handleDraftPublish(mockReq(), mockRes(), 'nonexistent');
    expect(captured.status).toBe(404);
  });

  it('returns 403 when draft belongs to different org', async () => {
    mockResolveUser.mockResolvedValue(teamOwner);
    const otherOrgDraft = { ...sampleDraft, org_id: 'org2', status: 'approved' };
    mockDbGetDraft.mockResolvedValue(otherOrgDraft);
    await handleDraftPublish(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(403);
  });

  it('returns 409 when draft is not approved', async () => {
    const submitted = { ...sampleDraft, status: 'submitted' };
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(submitted);
    await handleDraftPublish(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(409);
  });

  it('publishes approved draft and writes to changelog', async () => {
    const approved = { ...sampleDraft, status: 'approved' };
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(approved);
    const published = { ...approved, status: 'published' };
    mockDbPublishDraftWithRelease.mockResolvedValue(published);

    await handleDraftPublish(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
    expect(mockDbPublishDraftWithRelease).toHaveBeenCalledWith('draft1', 'myapp', expect.objectContaining({
      version: '1.0.0',
    }));
  });

  it('skips dbPublishDraftWithRelease when draft has no version', async () => {
    const approved = { ...sampleDraft, status: 'approved', version: '' };
    mockResolveUser.mockResolvedValue(teamOwner);
    mockDbGetDraft.mockResolvedValue(approved);
    mockDbUpdateDraftStatus.mockResolvedValue({ ...approved, status: 'published' });

    await handleDraftPublish(mockReq(), mockRes(), 'draft1');
    expect(captured.status).toBe(200);
    expect(mockDbPublishDraftWithRelease).not.toHaveBeenCalled();
    expect(mockDbUpdateDraftStatus).toHaveBeenCalledWith('draft1', 'published');
  });
});
