/** Project template DB operations (org-scoped). */

import { sql } from './client.js';

export interface DbProjectTemplate {
  id: string;
  org_id: string;
  name: string;
  config: Record<string, unknown>;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export async function dbCreateProjectTemplate(template: {
  id: string; orgId: string; name: string; config: Record<string, unknown>; createdBy: string;
}): Promise<DbProjectTemplate> {
  const rows = await sql<DbProjectTemplate[]>`
    INSERT INTO project_templates (id, org_id, name, config, created_by)
    VALUES (${template.id}, ${template.orgId}, ${template.name},
            ${JSON.stringify(template.config)}::jsonb, ${template.createdBy})
    RETURNING *
  `;
  return rows[0];
}

export async function dbListProjectTemplates(orgId: string): Promise<DbProjectTemplate[]> {
  return sql<DbProjectTemplate[]>`
    SELECT * FROM project_templates WHERE org_id = ${orgId} ORDER BY name
  `;
}

export async function dbGetProjectTemplate(id: string, orgId: string): Promise<DbProjectTemplate | null> {
  const rows = await sql<DbProjectTemplate[]>`
    SELECT * FROM project_templates WHERE id = ${id} AND org_id = ${orgId}
  `;
  return rows[0] || null;
}

export async function dbDeleteProjectTemplate(id: string, orgId: string): Promise<boolean> {
  const result = await sql`DELETE FROM project_templates WHERE id = ${id} AND org_id = ${orgId}`;
  return result.count > 0;
}
