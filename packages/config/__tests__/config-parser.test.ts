import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/index';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function withConfigFile(yaml: string, fn: (dir: string) => void) {
  const dir = join(tmpdir(), `cullit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.cullit.yml'), yaml, 'utf-8');
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('config YAML parsing', () => {
  it('parses basic key-value pairs', () => {
    withConfigFile(`
ai:
  provider: openai
  audience: end-user
  tone: casual
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('openai');
      expect(config.ai.audience).toBe('end-user');
      expect(config.ai.tone).toBe('casual');
    });
  });

  it('parses inline arrays', () => {
    withConfigFile(`
ai:
  provider: anthropic
  categories: [features, fixes, breaking]
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.categories).toEqual(['features', 'fixes', 'breaking']);
    });
  });

  it('parses boolean values', () => {
    withConfigFile(`
ai:
  provider: anthropic
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('anthropic');
    });
  });

  it('parses numeric values', () => {
    withConfigFile(`
ai:
  provider: anthropic
  maxTokens: 4096
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.maxTokens).toBe(4096);
    });
  });

  it('merges with defaults for missing fields', () => {
    withConfigFile(`
ai:
  provider: gemini
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('gemini');
      expect(config.ai.audience).toBe('developer'); // default
      expect(config.ai.tone).toBe('professional');   // default
      expect(config.source.type).toBe('local');       // default
    });
  });

  it('parses source configuration', () => {
    withConfigFile(`
source:
  type: jira
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.source.type).toBe('jira');
    });
  });

  it('parses jira configuration', () => {
    withConfigFile(`
jira:
  domain: mycompany.atlassian.net
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.jira?.domain).toBe('mycompany.atlassian.net');
    });
  });

  it('parses publish targets', () => {
    withConfigFile(`
publish:
  - type: stdout
  - type: file
    path: RELEASE_NOTES.md
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.publish).toHaveLength(2);
      expect(config.publish[0].type).toBe('stdout');
      expect(config.publish[1].type).toBe('file');
      expect(config.publish[1].path).toBe('RELEASE_NOTES.md');
    });
  });

  it('ignores comments', () => {
    withConfigFile(`
# This is a comment
ai:
  # Another comment
  provider: ollama
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('ollama');
    });
  });
});

describe('config env var resolution', () => {
  it('resolves $ENV_VAR references', () => {
    const key = `CULLIT_TEST_KEY_${Date.now()}`;
    process.env[key] = 'resolved-value';

    withConfigFile(`
jira:
  apiToken: $${key}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.jira?.apiToken).toBe('resolved-value');
    });

    delete process.env[key];
  });

  it('keeps $REF if env var is not set', () => {
    withConfigFile(`
jira:
  apiToken: $NONEXISTENT_VAR_12345
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.jira?.apiToken).toBe('$NONEXISTENT_VAR_12345');
    });
  });
});

describe('config error handling', () => {
  it('returns defaults for unparseable YAML', () => {
    withConfigFile(`
[[[invalid yaml{{{
`, (dir) => {
      // Should warn but return defaults, not throw
      const config = loadConfig(dir);
      expect(config.ai.provider).toBeDefined();
    });
  });
});

describe('v1.0.0 config fields', () => {
  it('parses gitlab configuration', () => {
    withConfigFile(`
gitlab:
  domain: gitlab.example.com
  projectId: "42"
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.gitlab?.domain).toBe('gitlab.example.com');
      expect(config.gitlab?.projectId).toBe('42');
    });
  });

  it('parses bitbucket configuration', () => {
    withConfigFile(`
bitbucket:
  workspace: my-team
  repoSlug: my-repo
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.bitbucket?.workspace).toBe('my-team');
      expect(config.bitbucket?.repoSlug).toBe('my-repo');
    });
  });

  it('parses confluence configuration', () => {
    withConfigFile(`
confluence:
  domain: myco.atlassian.net
  spaceKey: ENG
  parentPageId: "12345"
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.confluence?.domain).toBe('myco.atlassian.net');
      expect(config.confluence?.spaceKey).toBe('ENG');
      expect(config.confluence?.parentPageId).toBe('12345');
    });
  });

  it('parses notion configuration', () => {
    withConfigFile(`
notion:
  databaseId: abc123
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.notion?.databaseId).toBe('abc123');
    });
  });

  it('normalizes snake_case publish target keys', () => {
    withConfigFile(`
publish:
  - type: teams
    webhook_url: https://example.com/webhook
    template_profile: customer-facing
    section_order: [features, fixes, breaking]
  - type: confluence
    space_key: DEV
    parent_page_id: "999"
  - type: notion
    database_id: abc-def
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.publish[0].webhookUrl).toBe('https://example.com/webhook');
      expect(config.publish[0].templateProfile).toBe('customer-facing');
      expect(config.publish[0].sectionOrder).toEqual(['features', 'fixes', 'breaking']);
      expect(config.publish[1].spaceKey).toBe('DEV');
      expect(config.publish[1].parentPageId).toBe('999');
      expect(config.publish[2].databaseId).toBe('abc-def');
    });
  });

  it('parses template defaults and named template profiles', () => {
    withConfigFile(`
template:
  default: customer-facing
  section_order: [features, improvements, fixes, breaking, chores, other]
  include_metadata: false

templates:
  - name: customer-facing
    format: html-minimal
    section_order: [features, improvements, fixes, breaking, chores, other]
    include_contributors: false
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.template?.default).toBe('customer-facing');
      expect(config.template?.sectionOrder).toEqual(['features', 'improvements', 'fixes', 'breaking', 'chores', 'other']);
      expect(config.template?.includeMetadata).toBe(false);
      expect(config.templates).toHaveLength(1);
      expect(config.templates?.[0].name).toBe('customer-facing');
      expect(config.templates?.[0].format).toBe('html-minimal');
      expect(config.templates?.[0].includeContributors).toBe(false);
      expect(config.templates?.[0].sectionOrder).toEqual(['features', 'improvements', 'fixes', 'breaking', 'chores', 'other']);
    });
  });

  it('validates repos array with valid entries', () => {
    withConfigFile(`
source:
  type: multi-repo

repos:
  - url: https://github.com/acme/api.git
    name: API
  - path: ../shared
    name: Shared
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.repos).toHaveLength(2);
      expect(config.repos![0].url).toBe('https://github.com/acme/api.git');
      expect(config.repos![0].name).toBe('API');
      expect(config.repos![1].path).toBe('../shared');
    });
  });

  it('rejects repos entries missing both url and path', () => {
    expect(() => {
      withConfigFile(`
source:
  type: multi-repo

repos:
  - name: broken
`, (dir) => {
        loadConfig(dir);
      });
    }).toThrow('repos[0] must have either "url" or "path"');
  });
});

describe('parseSimpleYaml edge cases', () => {
  it('parses double-quoted string values', () => {
    withConfigFile(`
ai:
  provider: "openai"
  model: "gpt-4o"
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('openai');
      expect(config.ai.model).toBe('gpt-4o');
    });
  });

  it('parses single-quoted string values', () => {
    withConfigFile(`
ai:
  provider: 'anthropic'
  model: 'claude-3'
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('anthropic');
      expect(config.ai.model).toBe('claude-3');
    });
  });

  it('parses boolean true and false values', () => {
    withConfigFile(`
template:
  includeContributors: true
  includeMetadata: false
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.template?.includeContributors).toBe(true);
      expect(config.template?.includeMetadata).toBe(false);
    });
  });

  it('parses null values', () => {
    withConfigFile(`
ai:
  provider: anthropic
  model: null
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.model).toBeNull();
    });
  });

  it('strips inline comments from values', () => {
    withConfigFile(`
ai:
  provider: openai # use openai
  audience: developer # target devs
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('openai');
      expect(config.ai.audience).toBe('developer');
    });
  });

  it('handles empty config file', () => {
    withConfigFile('', (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('anthropic');
      expect(config.source.type).toBe('local');
    });
  });

  it('handles config file with only comments', () => {
    withConfigFile(`# This is a comment-only config
# No actual settings here
# Just comments
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('anthropic');
      expect(config.source.type).toBe('local');
    });
  });

  it('handles very long string values', () => {
    const longValue = 'a'.repeat(10000);
    withConfigFile(`
ai:
  provider: ${longValue}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe(longValue);
    });
  });

  it('handles unicode content in values', () => {
    withConfigFile(`
ai:
  provider: anthropic
  audience: 开发者
  tone: プロフェッショナル
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.audience).toBe('开发者');
      expect(config.ai.tone).toBe('プロフェッショナル');
    });
  });

  it('handles values containing colons (e.g. URLs)', () => {
    withConfigFile(`
jira:
  domain: https://mycompany.atlassian.net:8080
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.jira?.domain).toBe('https://mycompany.atlassian.net:8080');
    });
  });

  it('handles empty lines between sections', () => {
    withConfigFile(`
ai:
  provider: openai

source:
  type: local

publish:
  - type: stdout
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('openai');
      expect(config.source.type).toBe('local');
      expect(config.publish).toHaveLength(1);
    });
  });

  it('parses list-style (- item) array values', () => {
    withConfigFile(`
ai:
  provider: anthropic
  categories:
    - features
    - fixes
    - breaking
    - improvements
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.categories).toEqual(['features', 'fixes', 'breaking', 'improvements']);
    });
  });

  it('parses top-level key with inline value', () => {
    withConfigFile(`
ai:
  provider: anthropic
source:
  type: local
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('anthropic');
      expect(config.source.type).toBe('local');
    });
  });

  it('nested key without value creates empty object', () => {
    withConfigFile(`
ai:
  provider: anthropic
template:
  default: customer-facing
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.template?.default).toBe('customer-facing');
    });
  });
});

describe('env var resolution - extended', () => {
  it('resolves ${VAR} brace syntax', () => {
    const key = `CULLIT_BRACE_${Date.now()}`;
    process.env[key] = 'brace-value';

    withConfigFile(`
jira:
  apiToken: \${${key}}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.jira?.apiToken).toBe('brace-value');
    });

    delete process.env[key];
  });

  it('resolves GITHUB_ prefixed env vars', () => {
    const key = `GITHUB_TOKEN_TEST_${Date.now()}`;
    process.env[key] = 'gh-token-value';

    withConfigFile(`
source:
  type: github
  owner: $${key}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.source.owner).toBe('gh-token-value');
    });

    delete process.env[key];
  });

  it('resolves JIRA_ prefixed env vars', () => {
    const key = `JIRA_API_TOKEN_TEST_${Date.now()}`;
    process.env[key] = 'jira-token';

    withConfigFile(`
jira:
  apiToken: $${key}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.jira?.apiToken).toBe('jira-token');
    });

    delete process.env[key];
  });

  it('resolves LINEAR_ prefixed env vars', () => {
    const key = `LINEAR_API_KEY_TEST_${Date.now()}`;
    process.env[key] = 'linear-key';

    withConfigFile(`
linear:
  apiKey: $${key}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.linear?.apiKey).toBe('linear-key');
    });

    delete process.env[key];
  });

  it('resolves OPENAI_ and ANTHROPIC_ prefixed env vars', () => {
    const openaiKey = `OPENAI_KEY_TEST_${Date.now()}`;
    const anthropicKey = `ANTHROPIC_KEY_TEST_${Date.now()}`;
    process.env[openaiKey] = 'openai-key';
    process.env[anthropicKey] = 'anthropic-key';

    withConfigFile(`
ai:
  provider: openai
  apiKey: $${openaiKey}
  model: $${anthropicKey}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.apiKey).toBe('openai-key');
      expect(config.ai.model).toBe('anthropic-key');
    });

    delete process.env[openaiKey];
    delete process.env[anthropicKey];
  });

  it('resolves GITLAB_ and BITBUCKET_ prefixed env vars', () => {
    const gitlabKey = `GITLAB_TOKEN_TEST_${Date.now()}`;
    const bbKey = `BITBUCKET_TOKEN_TEST_${Date.now()}`;
    process.env[gitlabKey] = 'gl-token';
    process.env[bbKey] = 'bb-token';

    withConfigFile(`
gitlab:
  domain: $${gitlabKey}
  projectId: "42"
bitbucket:
  workspace: $${bbKey}
  repoSlug: my-repo
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.gitlab?.domain).toBe('gl-token');
      expect(config.bitbucket?.workspace).toBe('bb-token');
    });

    delete process.env[gitlabKey];
    delete process.env[bbKey];
  });

  it('resolves SLACK_, CONFLUENCE_, and NOTION_ prefixed env vars', () => {
    const slackKey = `SLACK_WEBHOOK_${Date.now()}`;
    const confKey = `CONFLUENCE_TOKEN_${Date.now()}`;
    const notionKey = `NOTION_TOKEN_${Date.now()}`;
    process.env[slackKey] = 'slack-url';
    process.env[confKey] = 'conf-token';
    process.env[notionKey] = 'notion-token';

    withConfigFile(`
publish:
  - type: slack
    webhookUrl: $${slackKey}
confluence:
  domain: $${confKey}
  spaceKey: ENG
notion:
  databaseId: $${notionKey}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.publish[0].webhookUrl).toBe('slack-url');
      expect(config.confluence?.domain).toBe('conf-token');
      expect(config.notion?.databaseId).toBe('notion-token');
    });

    delete process.env[slackKey];
    delete process.env[confKey];
    delete process.env[notionKey];
  });

  it('does not resolve non-whitelisted env vars', () => {
    process.env['HOME_LEAK_TEST'] = 'should-not-resolve';
    process.env['DATABASE_URL_TEST'] = 'should-not-resolve';
    process.env['AWS_SECRET_TEST'] = 'should-not-resolve';

    withConfigFile(`
ai:
  provider: $HOME_LEAK_TEST
  model: $DATABASE_URL_TEST
  audience: $AWS_SECRET_TEST
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.provider).toBe('$HOME_LEAK_TEST');
      expect(config.ai.model).toBe('$DATABASE_URL_TEST');
      expect(config.ai.audience).toBe('$AWS_SECRET_TEST');
    });

    delete process.env['HOME_LEAK_TEST'];
    delete process.env['DATABASE_URL_TEST'];
    delete process.env['AWS_SECRET_TEST'];
  });

  it('keeps original $REF for unset safe-prefix env vars', () => {
    const key = 'CULLIT_MISSING_VAR_XXXX_9999';
    delete process.env[key]; // ensure unset

    withConfigFile(`
ai:
  model: $${key}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.model).toBe(`$${key}`);
    });
  });

  it('resolves env vars in array items', () => {
    const key = `CULLIT_ARR_${Date.now()}`;
    process.env[key] = 'resolved-arr-val';

    withConfigFile(`
publish:
  - type: $${key}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.publish[0].type).toBe('resolved-arr-val');
    });

    delete process.env[key];
  });
});

describe('config security', () => {
  it('resolves env vars with safe prefixes (CULLIT_, GITHUB_, JIRA_, etc.)', () => {
    const key = `CULLIT_SAFE_${Date.now()}`;
    process.env[key] = 'safe-value';

    withConfigFile(`
ai:
  model: $${key}
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.model).toBe('safe-value');
    });

    delete process.env[key];
  });

  it('blocks env vars with unsafe prefixes (e.g. DATABASE_, AWS_)', () => {
    const key = `DATABASE_URL_TEST_${Date.now()}`;
    process.env[key] = 'postgres://secret';

    withConfigFile(`
ai:
  model: $${key}
`, (dir) => {
      const config = loadConfig(dir);
      // Should NOT resolve — keeps the $REF as-is
      expect(config.ai.model).toBe('$' + key);
    });

    delete process.env[key];
  });

  it('blocks env vars like AWS_ and SECRET_ from resolution', () => {
    process.env['AWS_SECRET_KEY_TEST'] = 'aws-leaked';
    process.env['SECRET_SAUCE_TEST'] = 'secret-leaked';

    withConfigFile(`
ai:
  model: $AWS_SECRET_KEY_TEST
  audience: $SECRET_SAUCE_TEST
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.ai.model).toBe('$AWS_SECRET_KEY_TEST');
    });

    delete process.env['AWS_SECRET_KEY_TEST'];
    delete process.env['SECRET_SAUCE_TEST'];
  });

  it('rejects __proto__ as a config key (prototype pollution)', () => {
    expect(() => {
      withConfigFile(`__proto__:
  polluted: true
`, (dir) => {
        loadConfig(dir);
      });
    }).toThrow(/reserved key/);
  });

  it('rejects prototype as a config key', () => {
    expect(() => {
      withConfigFile(`prototype:
  polluted: true
`, (dir) => {
        loadConfig(dir);
      });
    }).toThrow(/reserved key/);
  });

  it('rejects constructor as a config key', () => {
    expect(() => {
      withConfigFile(`constructor:
  polluted: true
`, (dir) => {
        loadConfig(dir);
      });
    }).toThrow(/reserved key/);
  });
});
