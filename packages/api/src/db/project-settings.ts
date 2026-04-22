/** Project settings DB operations (per-project defaults). */

import { sql } from './client.js';

export interface DbProjectSettings {
  id: string;
  org_id: string | null;
  user_id: string;
  project: string;
  default_source: string;
  default_provider: string;
  default_model: string;
  default_audience: string;
  default_tone: string;
  categories_json: unknown[];
  publish_targets_json: unknown[];
  widget_config_json: unknown | null;
  created_at: Date;
  updated_at: Date;
}

export async function dbGetProjectSettings(ownerId: string, project: string, orgId?: string | null): Promise<DbProjectSettings | null> {
  if (orgId) {
    const rows = await sql<DbProjectSettings[]>`
      SELECT * FROM project_settings WHERE org_id = ${orgId} AND project = ${project}`;
    return rows[0] || null;
  }
  const rows = await sql<DbProjectSettings[]>`
    SELECT * FROM project_settings WHERE user_id = ${ownerId} AND org_id IS NULL AND project = ${project}`;
  return rows[0] || null;
}

export async function dbUpsertProjectSettings(settings: {
  id: string; orgId: string | null; userId: string; project: string;
  defaultSource?: string; defaultProvider?: string; defaultModel?: string;
  defaultAudience?: string; defaultTone?: string;
  categoriesJson?: unknown[]; publishTargetsJson?: unknown[]; widgetConfigJson?: unknown;
}): Promise<DbProjectSettings> {
  const rows = await sql<DbProjectSettings[]>`
    INSERT INTO project_settings (id, org_id, user_id, project, default_source, default_provider, default_model,
      default_audience, default_tone, categories_json, publish_targets_json, widget_config_json)
    VALUES (${settings.id}, ${settings.orgId}, ${settings.userId}, ${settings.project},
      ${settings.defaultSource || 'local'}, ${settings.defaultProvider || 'none'}, ${settings.defaultModel || ''},
      ${settings.defaultAudience || 'developer'}, ${settings.defaultTone || 'professional'},
      ${JSON.stringify(settings.categoriesJson || [])}::jsonb, ${JSON.stringify(settings.publishTargetsJson || [])}::jsonb,
      ${settings.widgetConfigJson ? JSON.stringify(settings.widgetConfigJson) : null}::jsonb)
    ON CONFLICT (COALESCE(org_id, user_id), project) DO UPDATE SET
      default_source = EXCLUDED.default_source,
      default_provider = EXCLUDED.default_provider,
      default_model = EXCLUDED.default_model,
      default_audience = EXCLUDED.default_audience,
      default_tone = EXCLUDED.default_tone,
      categories_json = EXCLUDED.categories_json,
      publish_targets_json = EXCLUDED.publish_targets_json,
      widget_config_json = EXCLUDED.widget_config_json,
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

export async function dbListProjectSettings(ownerId: string, orgId?: string | null): Promise<DbProjectSettings[]> {
  if (orgId) {
    return sql<DbProjectSettings[]>`SELECT * FROM project_settings WHERE org_id = ${orgId} ORDER BY project`;
  }
  return sql<DbProjectSettings[]>`SELECT * FROM project_settings WHERE user_id = ${ownerId} AND org_id IS NULL ORDER BY project`;
}
