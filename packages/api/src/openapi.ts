import { VERSION } from '@cullit/core';

/**
 * OpenAPI 3.1 specification for the Cullit API.
 *
 * NOTE: This spec is manually maintained. When adding/changing endpoints in the
 * router (index.ts), update this file to match. A CI lint step should compare
 * declared paths here against the router's registered routes.
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Cullit API',
    version: VERSION,
    description: 'AI-powered release notes generation. Supports Anthropic Claude, OpenAI, Gemini, Ollama, and a template-based non-AI mode.',
    contact: {
      name: 'Cullit',
      url: 'https://cullit.io',
      email: 'dev@cullit.io',
    },
    license: {
      name: 'MIT',
      url: 'https://github.com/mttaylor/cullit/blob/main/LICENSE',
    },
  },
  servers: [
    { url: 'https://api.cullit.io', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  paths: {
    '/health': {
      get: {
        operationId: 'healthCheck',
        summary: 'Health check',
        description: 'Returns API status. May return "degraded" if the database is unreachable.',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/generate': {
      post: {
        operationId: 'generateReleaseNotes',
        summary: 'Generate release notes',
        description: 'Collects changes from git/Jira/Linear, generates AI-powered release notes, and returns the result.',
        tags: ['Release Notes'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GenerateRequest' },
              examples: {
                git: {
                  summary: 'From git tags',
                  value: {
                    from: 'v1.0.0',
                    to: 'v1.1.0',
                    provider: 'anthropic',
                    audience: 'developer',
                  },
                },
                jira: {
                  summary: 'From Jira',
                  value: {
                    from: 'project = PROJ AND fixVersion = "1.1"',
                    provider: 'openai',
                    source: { type: 'jira' },
                    jira: { domain: 'yourcompany.atlassian.net' },
                  },
                },
                linear: {
                  summary: 'From Linear',
                  value: {
                    from: 'team:ENG',
                    provider: 'gemini',
                    source: { type: 'linear' },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Release notes generated successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GenerateResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '401': {
            description: 'Unauthorized — missing or invalid Bearer token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '500': {
            description: 'Generation failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenApiSpec',
        summary: 'OpenAPI specification',
        tags: ['System'],
        responses: {
          '200': {
            description: 'OpenAPI 3.1 JSON specification',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
      },
    },
    '/v1/docs': {
      get: {
        operationId: 'getInteractiveDocs',
        summary: 'Interactive API documentation',
        description: 'Serves a self-contained HTML page with endpoint browser and "Try It" testing capability.',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Interactive API documentation page',
            content: {
              'text/html': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    },
    '/v1/changelog': {
      post: {
        operationId: 'publishChangelog',
        summary: 'Publish a release to the hosted changelog',
        description: 'Stores a release for a project. Requires Bearer token authentication.',
        tags: ['Changelog'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChangelogPublishRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Release published successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    url: { type: 'string' },
                    version: { type: 'string' },
                    project: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid request',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '401': {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/v1/changelog/{project}/latest': {
      get: {
        operationId: 'getChangelogLatest',
        summary: 'Get latest releases for a project',
        description: 'Returns the most recent releases for the given project slug. Public endpoint (no auth required).',
        tags: ['Changelog'],
        parameters: [
          {
            name: 'project',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Project slug (1-64 chars, alphanumeric/hyphens/underscores)',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 50 },
            description: 'Number of releases to return',
          },
        ],
        responses: {
          '200': {
            description: 'Releases for the project',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    project: { type: 'string' },
                    releases: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ChangelogRelease' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/auth/login': {
      get: {
        operationId: 'authLogin',
        summary: 'Start login via WorkOS AuthKit',
        description: 'Redirects to WorkOS AuthKit hosted login. On success, sets a session cookie and redirects to /dashboard.html.',
        tags: ['Auth'],
        responses: {
          '302': { description: 'Redirect to WorkOS AuthKit login' },
          '500': {
            description: 'OAuth not configured',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/auth/callback': {
      get: {
        operationId: 'authCallback',
        summary: 'OAuth callback',
        description: 'Handles the OAuth callback, exchanges code for token, creates/updates user, and sets session cookie.',
        tags: ['Auth'],
        parameters: [
          { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'state', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '302': { description: 'Redirect to dashboard on success' },
          '400': {
            description: 'Invalid state or missing code',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/auth/me': {
      get: {
        operationId: 'authMe',
        summary: 'Get current user',
        description: 'Returns the authenticated user from JWT session cookie or API key.',
        tags: ['Auth'],
        responses: {
          '200': {
            description: 'Current user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          '401': {
            description: 'Not authenticated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
      delete: {
        operationId: 'deleteAccount',
        summary: 'Delete account (GDPR)',
        description: 'Permanently deletes the authenticated user account and all associated data. Org owners must transfer ownership first.',
        tags: ['Auth'],
        responses: {
          '200': {
            description: 'Account deleted',
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } } },
          },
          '401': {
            description: 'Not authenticated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '409': {
            description: 'Must transfer org ownership first',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/auth/logout': {
      post: {
        operationId: 'authLogout',
        summary: 'Logout',
        description: 'Clears the session cookie.',
        tags: ['Auth'],
        responses: {
          '200': { description: 'Logged out', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
        },
      },
    },
    '/v1/org': {
      get: {
        operationId: 'getOrg',
        summary: 'Get current organization',
        description: 'Returns org details and member list for the authenticated user.',
        tags: ['Team'],
        responses: {
          '200': {
            description: 'Organization details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OrgResponse' } } },
          },
          '401': {
            description: 'Not authenticated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
      post: {
        operationId: 'createOrg',
        summary: 'Create an organization',
        description: 'Creates a new org with the current user as owner.',
        tags: ['Team'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 2, maxLength: 64 } } },
            },
          },
        },
        responses: {
          '201': {
            description: 'Organization created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OrgResponse' } } },
          },
          '409': {
            description: 'Already in an org',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/v1/org/invite': {
      post: {
        operationId: 'orgInvite',
        summary: 'Invite a member',
        description: 'Adds a user to the org. Requires owner or admin role.',
        tags: ['Team'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId'],
                properties: {
                  userId: { type: 'string' },
                  role: { type: 'string', enum: ['admin', 'member'], default: 'member' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Member added', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
          '403': { description: 'Insufficient permissions', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Cannot add member', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/org/members': {
      delete: {
        operationId: 'orgRemoveMember',
        summary: 'Remove a member',
        description: 'Removes a user from the org. Requires owner or admin role.',
        tags: ['Team'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': { description: 'Member removed', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
          '403': { description: 'Insufficient permissions', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Cannot remove member', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/history': {
      get: {
        operationId: 'getHistory',
        summary: 'Get generation history',
        description: 'Returns paginated generation history for the authenticated user.',
        tags: ['History'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0, minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'History entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    entries: { type: 'array', items: { $ref: '#/components/schemas/HistoryEntry' } },
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/analytics/usage': {
      get: {
        operationId: 'getAnalyticsUsage',
        summary: 'Get usage analytics',
        description: 'Returns daily usage stats, provider breakdown, and monthly generation count.',
        tags: ['Analytics'],
        parameters: [
          { name: 'days', in: 'query', schema: { type: 'integer', default: 30, minimum: 1, maximum: 90 } },
        ],
        responses: {
          '200': {
            description: 'Usage analytics',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalyticsResponse' } } },
          },
          '401': { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/events': {
      post: {
        operationId: 'trackFunnelEvent',
        summary: 'Track a funnel event',
        description: 'Records lightweight conversion funnel events for launch and growth monitoring.',
        tags: ['Analytics'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['event'],
                properties: {
                  event: {
                    type: 'string',
                    enum: [
                      'landing_cta_clicked',
                      'pricing_viewed',
                      'checkout_started',
                      'checkout_redirected',
                      'checkout_failed',
                      'paid_activated',
                      'first_generate_success',
                      'first_publish_success',
                    ],
                  },
                  plan: { type: 'string', enum: ['free', 'pro', 'team', 'enterprise'] },
                  source: { type: 'string' },
                  metadata: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          '202': { description: 'Event accepted' },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/drafts': {
      get: {
        operationId: 'listDrafts',
        summary: 'List release drafts',
        description: 'Returns paginated release drafts for the current team/user context.',
        tags: ['Drafts'],
        responses: {
          '200': { description: 'Draft list returned' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Team plan required' },
        },
      },
      post: {
        operationId: 'createDraft',
        summary: 'Create release draft',
        description: 'Creates a release draft for collaborative review and publishing.',
        tags: ['Drafts'],
        responses: {
          '201': { description: 'Draft created' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Team plan required' },
        },
      },
    },
    '/v1/projects/settings': {
      get: {
        operationId: 'listProjectSettings',
        summary: 'List project settings',
        description: 'Returns saved project defaults for the current team/user context.',
        tags: ['Team'],
        responses: {
          '200': { description: 'Project settings returned' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Team plan required' },
        },
      },
    },
    '/v1/org/invites': {
      get: {
        operationId: 'listOrgInvites',
        summary: 'List pending org invites',
        tags: ['Team'],
        responses: {
          '200': { description: 'Invite list returned' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Insufficient permissions' },
        },
      },
      post: {
        operationId: 'createOrgInviteEmail',
        summary: 'Create org invite by email',
        tags: ['Team'],
        responses: {
          '201': { description: 'Invite created' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Insufficient permissions' },
        },
      },
    },
    '/v1/org/usage': {
      get: {
        operationId: 'getOrgUsage',
        summary: 'Get org usage snapshot',
        tags: ['Team'],
        responses: {
          '200': { description: 'Org usage returned' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/v1/org/keys': {
      get: {
        operationId: 'listTeamKeys',
        summary: 'List team API keys',
        description: 'Returns all team API keys for the caller\'s org. Admins and owners see full keys; members see masked keys.',
        tags: ['Team'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Team API keys',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    keys: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          apiKey: { type: 'string', description: 'Full key for admins, masked for members' },
                          label: { type: 'string' },
                          assignedToEmail: { type: 'string', nullable: true },
                          assignedToName: { type: 'string', nullable: true },
                          assignedAt: { type: 'string', format: 'date-time', nullable: true },
                          revokedAt: { type: 'string', format: 'date-time', nullable: true },
                          createdAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Not authenticated' },
          '403': { description: 'No organization' },
        },
      },
    },
    '/v1/org/keys/{keyId}': {
      patch: {
        operationId: 'updateTeamKey',
        summary: 'Update team key label or assignment',
        description: 'Update a team API key\'s label, assigned email, or assigned name. Requires org owner or admin role.',
        tags: ['Team'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  label: { type: 'string', maxLength: 64 },
                  assignedToEmail: { type: 'string', nullable: true, format: 'email' },
                  assignedToName: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Key updated' },
          '400': { description: 'Invalid input' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Must be org owner or admin' },
          '404': { description: 'Key not found' },
        },
      },
    },
    '/v1/org/keys/{keyId}/send': {
      post: {
        operationId: 'sendTeamKey',
        summary: 'Email team key to assignee',
        description: 'Sends the API key to its assigned email address. Key must have an assigned email and not be revoked.',
        tags: ['Team'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Email sent (or skipped if email not configured)' },
          '400': { description: 'No email assigned or key is revoked' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Must be org owner or admin' },
          '404': { description: 'Key not found' },
        },
      },
    },
    '/v1/org/keys/{keyId}/revoke': {
      post: {
        operationId: 'revokeTeamKey',
        summary: 'Revoke a team API key',
        description: 'Permanently revokes a team API key. The key will immediately stop working.',
        tags: ['Team'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Key revoked' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Must be org owner or admin' },
          '404': { description: 'Key not found or already revoked' },
        },
      },
    },
    '/v1/org/keys/{keyId}/rotate': {
      post: {
        operationId: 'rotateTeamKey',
        summary: 'Rotate a team API key',
        description: 'Generates a new API key value, immediately invalidating the old one. Returns the new key.',
        tags: ['Team'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'New API key',
            content: { 'application/json': { schema: { type: 'object', properties: { apiKey: { type: 'string' } } } } },
          },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Must be org owner or admin' },
          '404': { description: 'Key not found or revoked' },
        },
      },
    },
    '/v1/generate': {
      post: {
        operationId: 'generateV1',
        summary: 'Generate release notes (v1)',
        description: 'Alias for POST /generate with usage enforcement.',
        tags: ['Generation'],
        security: [{ bearerAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateRequest' } } } },
        responses: {
          '200': { description: 'Generated release notes', content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateResponse' } } } },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '402': { description: 'Monthly generation limit reached', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/v1/billing/checkout': {
      post: {
        operationId: 'createCheckout',
        summary: 'Create Stripe checkout session',
        description: 'Initiates a Stripe Checkout session for Pro or Team plan subscription.',
        tags: ['Billing'],
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  plan: { type: 'string', enum: ['pro', 'team'] },
                  annual: { type: 'boolean', description: 'Use annual billing (15% discount)' },
                  seats: { type: 'integer', description: 'Number of seats (team plan only, min 5, max 100)', minimum: 5, maximum: 100 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Checkout session URL',
            content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } } } },
          },
          '401': { description: 'Not authenticated' },
          '503': { description: 'Billing not configured' },
        },
      },
    },
    '/v1/billing/portal': {
      post: {
        operationId: 'createBillingPortal',
        summary: 'Create Stripe customer portal session',
        description: 'Returns a URL to the Stripe customer portal for managing subscriptions.',
        tags: ['Billing'],
        security: [{ cookieAuth: [] }],
        responses: {
          '200': {
            description: 'Portal session URL',
            content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } } } },
          },
          '400': { description: 'No billing account' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/v1/billing/subscription': {
      get: {
        operationId: 'getSubscription',
        summary: 'Get current subscription status',
        tags: ['Billing'],
        security: [{ cookieAuth: [] }],
        responses: {
          '200': {
            description: 'Subscription status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    subscription: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        plan: { type: 'string' },
                        status: { type: 'string' },
                        currentPeriodEnd: { type: 'string', format: 'date-time' },
                        cancelAtPeriodEnd: { type: 'boolean' },
                      },
                    },
                    plan: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/healthz': {
      get: {
        summary: 'Health check (alias)',
        tags: ['System'],
        responses: { 200: { description: 'Health status (same as /health)' } },
      },
    },
    '/metrics': {
      get: {
        summary: 'Prometheus metrics',
        tags: ['System'],
        description: 'Returns counters in Prometheus text exposition format. Gated by METRICS_TOKEN if set.',
        parameters: [{ name: 'Authorization', in: 'header', schema: { type: 'string' }, description: 'Bearer <METRICS_TOKEN>' }],
        responses: {
          200: { description: 'Metrics in Prometheus text format', content: { 'text/plain': { schema: { type: 'string' } } } },
          403: { description: 'Forbidden — invalid or missing metrics token' },
        },
      },
    },
    '/auth/rotate-key': {
      post: {
        summary: 'Rotate API key',
        tags: ['Auth'],
        description: 'Generates a new API key, invalidating the previous one.',
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          200: { description: 'New API key', content: { 'application/json': { schema: { type: 'object', properties: { apiKey: { type: 'string' } } } } } },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/v1/changelog/projects': {
      get: {
        summary: 'List changelog projects',
        tags: ['Changelog'],
        responses: { 200: { description: 'Array of project slugs with release counts' } },
      },
    },
    '/v1/changelog/{project}/{version}': {
      delete: {
        summary: 'Delete a changelog release',
        tags: ['Changelog'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'project', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'version', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Release deleted' },
          401: { description: 'Not authenticated' },
          404: { description: 'Release not found' },
        },
      },
    },
    '/v1/billing/webhook': {
      post: {
        summary: 'Stripe webhook handler',
        tags: ['Billing'],
        description: 'Receives Stripe webhook events for subscription lifecycle management.',
        responses: { 200: { description: 'Webhook processed' }, 400: { description: 'Invalid signature or payload' } },
      },
    },
    '/v1/drafts/{id}': {
      get: {
        summary: 'Get draft details',
        tags: ['Drafts'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Draft with revision history' }, 404: { description: 'Draft not found' } },
      },
      patch: {
        summary: 'Update draft',
        tags: ['Drafts'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } } } } } },
        responses: { 200: { description: 'Draft updated' }, 404: { description: 'Draft not found' } },
      },
      delete: {
        summary: 'Delete draft',
        tags: ['Drafts'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Draft deleted' }, 404: { description: 'Draft not found' } },
      },
    },
    '/v1/drafts/{id}/submit': {
      post: {
        summary: 'Submit draft for review',
        tags: ['Drafts'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Draft submitted' }, 404: { description: 'Draft not found' } },
      },
    },
    '/v1/drafts/{id}/approve': {
      post: {
        summary: 'Approve draft',
        tags: ['Drafts'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Draft approved' }, 404: { description: 'Draft not found' } },
      },
    },
    '/v1/drafts/{id}/publish': {
      post: {
        summary: 'Publish draft to changelog',
        tags: ['Drafts'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Draft published' }, 404: { description: 'Draft not found' } },
      },
    },
    '/v1/projects/{project}/settings': {
      put: {
        summary: 'Save project defaults',
        tags: ['Projects'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'project', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Settings saved' }, 401: { description: 'Not authenticated' } },
      },
    },
    '/v1/org/invites/{id}': {
      delete: {
        summary: 'Revoke org invite',
        tags: ['Team'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Invite revoked' }, 404: { description: 'Invite not found' } },
      },
    },
    '/v1/org/members/{userId}': {
      patch: {
        summary: 'Update org member role',
        tags: ['Team'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { role: { type: 'string', enum: ['admin', 'member'] } } } } } },
        responses: { 200: { description: 'Role updated' }, 404: { description: 'Member not found' } },
      },
    },
    '/v1/audit': {
      get: {
        operationId: 'getAuditLog',
        summary: 'Get audit log events',
        description: 'Returns paginated audit log events for the authenticated user. Requires Team 25 or Enterprise plan.',
        tags: ['Premium'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0, minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'Paginated audit events',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                events: { type: 'array', items: { type: 'object', properties: {
                  id: { type: 'string' }, userId: { type: 'string' }, action: { type: 'string' },
                  target: { type: 'string' }, metadata: { type: 'object' }, createdAt: { type: 'string' },
                } } },
                total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' },
              },
            } } },
          },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Requires Team 25 or Enterprise plan' },
        },
      },
    },
    '/v1/templates': {
      get: {
        operationId: 'listTemplates',
        summary: 'List project templates',
        description: 'Returns all project templates for the user\'s organization. Requires Team 25 or Enterprise plan.',
        tags: ['Premium'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          '200': {
            description: 'List of templates',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: { templates: { type: 'array', items: { $ref: '#/components/schemas/ProjectTemplate' } } },
            } } },
          },
          '400': { description: 'Organization required' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Requires Team 25 or Enterprise plan' },
        },
      },
      post: {
        operationId: 'createTemplate',
        summary: 'Create a project template',
        description: 'Creates a new project template. Requires Team 25 or Enterprise plan and an organization.',
        tags: ['Premium'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['name'],
            properties: {
              name: { type: 'string', maxLength: 100 },
              config: { type: 'object', description: 'Template configuration (provider, audience, tone, etc.)' },
            },
          } } },
        },
        responses: {
          '201': { description: 'Template created', content: { 'application/json': { schema: { type: 'object', properties: { template: { $ref: '#/components/schemas/ProjectTemplate' } } } } } },
          '400': { description: 'Invalid request or organization required' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Requires Team 25 or Enterprise plan' },
        },
      },
    },
    '/v1/templates/{id}': {
      delete: {
        operationId: 'deleteTemplate',
        summary: 'Delete a project template',
        description: 'Deletes a project template by ID. Requires Team 25 or Enterprise plan.',
        tags: ['Premium'],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^tpl_[a-f0-9]{24}$' } }],
        responses: {
          '200': { description: 'Template deleted' },
          '400': { description: 'Invalid template ID or organization required' },
          '401': { description: 'Not authenticated' },
          '403': { description: 'Requires Team 25 or Enterprise plan' },
          '404': { description: 'Template not found' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'API token (CULLIT_API_TOKEN)' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'cullit_session', description: 'GitHub OAuth session cookie' },
    },
    schemas: {
      GenerateRequest: {
        type: 'object',
        required: ['from'],
        properties: {
          from: {
            type: 'string',
            description: 'Start ref (tag/SHA), JQL query (Jira), or filter expression (Linear)',
            examples: ['v1.0.0', 'HEAD~10', 'project = PROJ'],
          },
          to: {
            type: 'string',
            default: 'HEAD',
            description: 'End ref (tag/SHA). Defaults to HEAD.',
          },
          provider: {
            type: 'string',
            enum: ['anthropic', 'openai', 'gemini', 'ollama', 'none'],
            default: 'anthropic',
          },
          model: {
            type: 'string',
            description: 'Override the default model for the chosen provider',
            examples: ['claude-sonnet-4-6-20250514', 'gpt-4o', 'gemini-2.5-flash'],
          },
          audience: {
            type: 'string',
            enum: ['developer', 'end-user', 'executive'],
            default: 'developer',
          },
          tone: {
            type: 'string',
            enum: ['professional', 'casual', 'terse'],
            default: 'professional',
          },
          format: {
            type: 'string',
            enum: ['markdown', 'html', 'json'],
            default: 'markdown',
          },
          categories: {
            type: 'array',
            items: { type: 'string' },
            default: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
          },
          source: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['local', 'jira', 'linear'],
                default: 'local',
              },
              enrichment: {
                type: 'array',
                items: { type: 'string', enum: ['jira', 'linear'] },
              },
            },
          },
          jira: {
            type: 'object',
            properties: {
              domain: { type: 'string', description: 'e.g. yourcompany.atlassian.net' },
            },
          },
          linear: {
            type: 'object',
            properties: {
              apiKey: { type: 'string', description: 'Linear API key (or use LINEAR_API_KEY env var)' },
            },
          },

        },
      },
      GenerateResponse: {
        type: 'object',
        properties: {
          version: { type: 'string' },
          date: { type: 'string', format: 'date' },
          summary: { type: 'string' },
          changes: {
            type: 'array',
            items: { $ref: '#/components/schemas/ChangeEntry' },
          },
          changeCount: { type: 'integer' },
          contributors: {
            type: 'array',
            items: { type: 'string' },
          },
          formatted: {
            type: 'string',
            description: 'Pre-formatted release notes in the requested format',
          },
          metadata: {
            type: 'object',
            properties: {
              commitCount: { type: 'integer' },
              prCount: { type: 'integer' },
              ticketCount: { type: 'integer' },
              generatedBy: { type: 'string' },
              generatedAt: { type: 'string', format: 'date-time' },
            },
          },
          duration: {
            type: 'number',
            description: 'Generation time in milliseconds',
          },
        },
      },
      ChangeEntry: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          category: {
            type: 'string',
            enum: ['features', 'fixes', 'breaking', 'improvements', 'chores', 'other'],
          },
          ticketKey: { type: 'string', nullable: true },
          commits: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
      ChangelogPublishRequest: {
        type: 'object',
        required: ['project', 'version', 'changes'],
        properties: {
          project: { type: 'string', description: 'Project slug (1-64 chars, alphanumeric/hyphens/underscores)' },
          version: { type: 'string', description: 'Release version string', maxLength: 64 },
          date: { type: 'string', description: 'Release date (defaults to today)' },
          summary: { type: 'string', description: 'Release summary' },
          changes: {
            type: 'array',
            maxItems: 50,
            items: { $ref: '#/components/schemas/ChangeEntry' },
          },
          contributors: {
            type: 'array',
            items: { type: 'string' },
          },
          metadata: { type: 'object' },
          formatted: {
            type: 'object',
            properties: {
              markdown: { type: 'string' },
              html: { type: 'string' },
            },
          },
        },
      },
      ChangelogRelease: {
        type: 'object',
        properties: {
          version: { type: 'string' },
          date: { type: 'string' },
          summary: { type: 'string' },
          changes: {
            type: 'array',
            items: { $ref: '#/components/schemas/ChangeEntry' },
          },
          contributors: {
            type: 'array',
            items: { type: 'string' },
          },
          metadata: { type: 'object' },
          formatted: {
            type: 'object',
            properties: {
              markdown: { type: 'string' },
              html: { type: 'string' },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          login: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          avatarUrl: { type: 'string' },
          tier: { type: 'string', enum: ['free', 'pro', 'team', 'enterprise'] },
          orgId: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['owner', 'admin', 'member'] },
          apiKey: { type: 'string' },
          preferredProvider: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      OrgResponse: {
        type: 'object',
        properties: {
          org: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              slug: { type: 'string' },
              tier: { type: 'string', enum: ['team', 'enterprise'] },
              maxSeats: { type: 'integer' },
              memberCount: { type: 'integer' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                login: { type: 'string' },
                name: { type: 'string' },
                avatarUrl: { type: 'string' },
                role: { type: 'string', enum: ['owner', 'admin', 'member'] },
              },
            },
          },
        },
      },
      HistoryEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          project: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          provider: { type: 'string' },
          format: { type: 'string' },
          changeCount: { type: 'integer' },
          summary: { type: 'string' },
          duration: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      DailyUsage: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date' },
          generations: { type: 'integer' },
          totalChanges: { type: 'integer' },
          avgDuration: { type: 'number' },
          providers: { type: 'object', additionalProperties: { type: 'integer' } },
        },
      },
      AnalyticsResponse: {
        type: 'object',
        properties: {
          daily: { type: 'array', items: { $ref: '#/components/schemas/DailyUsage' } },
          totals: {
            type: 'object',
            properties: {
              generations: { type: 'integer' },
              totalChanges: { type: 'integer' },
              avgDuration: { type: 'number' },
            },
          },
          topProviders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                provider: { type: 'string' },
                count: { type: 'integer' },
              },
            },
          },
          monthlyGenerations: { type: 'integer' },
          tier: { type: 'string' },
          teamAnalytics: { type: 'boolean', description: 'Whether detailed team analytics are available (Team 25+ only)' },
        },
      },
      ProjectTemplate: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          orgId: { type: 'string' },
          name: { type: 'string' },
          config: { type: 'object', description: 'Template configuration' },
          createdBy: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};
