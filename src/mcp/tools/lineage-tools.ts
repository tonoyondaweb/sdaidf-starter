import { z } from 'zod';
import type { QueryToolResult, ErrorResponse } from '../types.js';
import { getConfig } from '../config.js';
import { createExclusionChecker } from '../metadata-proxy/index.js';
import { executeSQL } from '../command-executor.js';

const LineageObjectTypes = ['table', 'view', 'materialized_view'] as const;

const GetLineageSchema = z.object({
  objectName: z.string().describe('Name of the object'),
  objectType: z.enum(LineageObjectTypes).describe('Type of object (table, view, materialized_view)'),
  database: z.string().optional().describe('Database name'),
  schema: z.string().optional().describe('Schema name'),
  direction: z.enum(['upstream', 'downstream', 'both']).default('both').describe('Direction of dependencies to fetch'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

const GetDependenciesSchema = z.object({
  objectName: z.string().describe('Name of the object'),
  objectType: z.enum(['view', 'materialized_view', 'function', 'procedure']).describe('Type of object'),
  database: z.string().optional().describe('Database name'),
  schema: z.string().optional().describe('Schema name'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

function createErrorResponse(error: string, message: string, code: string): ErrorResponse {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error, message, code }),
    }],
    isError: true,
    error,
    code,
  };
}

function parseTabularResult(stdout: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = stdout.trim().split('\n').filter(Boolean);
  
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
  const rows = lines.slice(1).map(line => {
    const values = line.split('\t');
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i]?.trim() || '';
    });
    return row;
  });
  
  return { headers, rows };
}

export async function getLineageTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = GetLineageSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E3000'
    );
  }
  
  const { objectName, objectType, database, schema, direction, connection } = parsed.data;
  const config = getConfig();
  
  const exclusionChecker = createExclusionChecker(
    config.exclusions.patterns,
    config.exclusions.objectTypes
  );
  
  const checkResult = exclusionChecker.check(objectName);
  if (checkResult.isExcluded) {
    return createErrorResponse(
      'EXCLUDED_OBJECT',
      `Object '${objectName}' matches exclusion pattern '${checkResult.matchedPattern}'`,
      'E3001'
    );
  }
  
  const normalizedDirection = direction.toUpperCase();
  const normalizedType = objectType.toUpperCase().replace(' ', '_');
  
  const lineageQuery = `
    SELECT * FROM TABLE(
      SNOWFLAKE.CORE.OBJECT_DEPENDENCIES(
        OBJECT_NAME => '${objectName}',
        OBJECT_TYPE => '${normalizedType}',
        DIRECTION => '${normalizedDirection}'
      )
    )
  `;
  
  const result = await executeSQL(lineageQuery, { connection });
  
  if (result.exitCode !== 0) {
    return createErrorResponse(
      'CLI_ERROR',
      result.stderr || 'Unknown error - make sure SNOWFLAKE.CORE is available',
      'E3002'
    );
  }
  
  const { rows } = parseTabularResult(result.stdout);
  
  const upstream = rows.filter(r => 
    r.direction?.toLowerCase() === 'upstream' || r.referencing_object_name !== objectName
  );
  const downstream = rows.filter(r => 
    r.direction?.toLowerCase() === 'downstream' || r.referenced_object_name !== objectName
  );
  
  return {
    content: [{ type: 'text', text: JSON.stringify({
      objectName,
      objectType: normalizedType,
      direction,
      totalCount: rows.length,
      upstream: direction === 'upstream' || direction === 'both' ? upstream : [],
      downstream: direction === 'downstream' || direction === 'both' ? downstream : [],
      all: rows,
      _meta: { database, schema }
    }) }],
  };
}

export async function getDependenciesTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = GetDependenciesSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E3000'
    );
  }
  
  const { objectName, objectType, database, schema, connection } = parsed.data;
  const config = getConfig();
  
  const exclusionChecker = createExclusionChecker(
    config.exclusions.patterns,
    config.exclusions.objectTypes
  );
  
  const checkResult = exclusionChecker.check(objectName);
  if (checkResult.isExcluded) {
    return createErrorResponse(
      'EXCLUDED_OBJECT',
      `Object '${objectName}' matches exclusion pattern '${checkResult.matchedPattern}'`,
      'E3001'
    );
  }
  
  const dbName = database || 'INFORMATION_SCHEMA';
  const schemaName = schema || '';
  
  const normalizedType = objectType.toUpperCase().replace(' ', '_');
  
  const depsQuery = `
    SELECT 
      REFERENCE_OBJECT_NAME,
      REFERENCE_OBJECT_TYPE,
      REFERENCE_SCHEMA_NAME,
      REFERENCE_DATABASE_NAME,
      OBJECT_NAME,
      OBJECT_SCHEMA,
      OBJECT_DATABASE
    FROM ${dbName}${schemaName ? `.${schemaName}` : ''}.OBJECT_REFERENCES
    WHERE OBJECT_NAME = '${objectName}'
      OR OBJECT_NAME = UPPER('${objectName}')
  `;
  
  const result = await executeSQL(depsQuery, { connection });
  
  if (result.exitCode !== 0) {
    return createErrorResponse(
      'CLI_ERROR',
      result.stderr || 'Unknown error',
      'E3003'
    );
  }
  
  const { rows } = parseTabularResult(result.stdout);
  
  const dependencies = rows.map(row => ({
    name: row.reference_object_name || row.reference_object_name,
    type: row.reference_object_type || row.referenced_object_type,
    schema: row.reference_schema_name || row.object_schema,
    database: row.reference_database_name || row.object_database,
  })).filter(dep => dep.name);
  
  return {
    content: [{ type: 'text', text: JSON.stringify({
      objectName,
      objectType: normalizedType,
      totalCount: dependencies.length,
      dependencies,
      _meta: { database, schema }
    }) }],
  };
}
