import { VERSION } from '@cullit/core';

/**
 * OpenAPI 3.1 specification for the Cullit API.
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Cullit API',
    version: VERSION,
    description: 'AI-powered release notes generation. Supports Anthropic Claude, OpenAI, Gemini, Ollama, OpenClaw, and a template-based non-AI mode.',
    contact: {
      name: 'Cullit',
      url: 'https://cullit.io',
      email: 'matt@cullit.io',
    },
    license: {
      name: 'MIT',
      url: 'https://github.com/mttaylor/cullit/blob/main/LICENSE',
    },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  paths: {
    '/health': {
      get: {
        operationId: 'healthCheck',
        summary: 'Health check',
        description: 'Returns API status, version, and uptime.',
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
                    version: { type: 'string', example: VERSION },
                    uptime: { type: 'number', description: 'Uptime in seconds' },
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
  },
  components: {
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
            enum: ['anthropic', 'openai', 'gemini', 'ollama', 'openclaw', 'none'],
            default: 'anthropic',
          },
          model: {
            type: 'string',
            description: 'Override the default model for the chosen provider',
            examples: ['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-2.0-flash'],
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
    },
  },
};
