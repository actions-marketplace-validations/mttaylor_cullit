import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CullConfig } from '../types';

const DEFAULT_CONFIG: CullConfig = {
  ai: {
    provider: 'anthropic',
    audience: 'developer',
    tone: 'professional',
    categories: ['features', 'fixes', 'breaking', 'improvements', 'chores'],
  },
  source: {
    type: 'local',
  },
  publish: [{ type: 'stdout' }],
};

/**
 * Loads config from .cullit.yml in the project root.
 * Falls back to sensible defaults.
 * Resolves environment variable references ($ENV_VAR syntax).
 */
export function loadConfig(cwd: string = process.cwd()): CullConfig {
  const configPath = join(cwd, '.cullit.yml');

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parseSimpleYaml(raw);
    const resolved = resolveEnvVars(parsed);
    return mergeWithDefaults(resolved);
  } catch (err) {
    console.warn(`⚠ Could not parse .cullit.yml: ${(err as Error).message}`);
    console.warn('Using default configuration.');
    return DEFAULT_CONFIG;
  }
}

/**
 * Simple YAML parser for our flat-ish config structure.
 * For v1, avoids adding a yaml dependency. Handles our specific schema.
 */
function parseSimpleYaml(raw: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection = '';
  let currentArray: any[] | null = null;
  let currentArrayKey = '';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    // Top-level key
    if (indent === 0 && trimmed.includes(':')) {
      const [key, ...valParts] = trimmed.split(':');
      const val = valParts.join(':').trim();
      if (val) {
        result[key.trim()] = parseValue(val);
      } else {
        result[key.trim()] = {};
        currentSection = key.trim();
      }
      currentArray = null;
      continue;
    }

    // Array item (- syntax)
    if (trimmed.startsWith('- ')) {
      const content = trimmed.substring(2).trim();
      if (content.includes(':') && !content.startsWith('"') && !content.startsWith("'")) {
        // Object in array
        if (currentArray === null) {
          currentArray = [];
          if (currentSection && currentArrayKey) {
            (result[currentSection] as any)[currentArrayKey] = currentArray;
          }
        }
        const obj: Record<string, any> = {};
        const [k, ...vParts] = content.split(':');
        obj[k.trim()] = parseValue(vParts.join(':').trim());
        currentArray.push(obj);
      } else {
        // Simple array value
        if (!Array.isArray(result[currentSection]?.[currentArrayKey])) {
          if (currentSection) {
            (result[currentSection] as any)[currentArrayKey] = [];
          }
        }
        (result[currentSection] as any)[currentArrayKey]?.push(parseValue(content));
      }
      continue;
    }

    // Nested key: value
    if (indent > 0 && trimmed.includes(':')) {
      const [key, ...valParts] = trimmed.split(':');
      const val = valParts.join(':').trim();
      if (val) {
        if (currentSection) {
          (result[currentSection] as any)[key.trim()] = parseValue(val);
        }
      } else {
        currentArrayKey = key.trim();
        if (currentSection) {
          (result[currentSection] as any)[currentArrayKey] = {};
        }
      }
      currentArray = null;
    }
  }

  return result;
}

function parseValue(val: string): any {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  // Remove quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  // Array syntax [a, b, c]
  if (val.startsWith('[') && val.endsWith(']')) {
    return val.slice(1, -1).split(',').map(s => parseValue(s.trim()));
  }
  return val;
}

/**
 * Resolves $ENV_VAR references in config values.
 */
function resolveEnvVars(obj: any): any {
  if (typeof obj === 'string' && obj.startsWith('$')) {
    const envKey = obj.substring(1);
    return process.env[envKey] || obj;
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj && typeof obj === 'object') {
    const resolved: any = {};
    for (const [k, v] of Object.entries(obj)) {
      resolved[k] = resolveEnvVars(v);
    }
    return resolved;
  }
  return obj;
}

function mergeWithDefaults(parsed: Record<string, any>): CullConfig {
  return {
    ai: {
      ...DEFAULT_CONFIG.ai,
      ...(parsed.ai || {}),
    },
    source: {
      ...DEFAULT_CONFIG.source,
      ...(parsed.source || {}),
    },
    publish: parsed.publish || DEFAULT_CONFIG.publish,
    jira: parsed.jira,
    linear: parsed.linear,
  };
}
