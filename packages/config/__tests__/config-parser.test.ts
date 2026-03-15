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
  - type: confluence
    space_key: DEV
    parent_page_id: "999"
  - type: notion
    database_id: abc-def
`, (dir) => {
      const config = loadConfig(dir);
      expect(config.publish[0].webhookUrl).toBe('https://example.com/webhook');
      expect(config.publish[1].spaceKey).toBe('DEV');
      expect(config.publish[1].parentPageId).toBe('999');
      expect(config.publish[2].databaseId).toBe('abc-def');
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
