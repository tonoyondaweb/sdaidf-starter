import { z } from 'zod';
import type { QueryToolResult, ErrorResponse } from '../types.js';
import { getConfig } from '../config.js';
import { createExclusionChecker } from '../metadata-proxy/index.js';
import { executeSnowCLI, executeSQL } from '../command-executor.js';

const OBJECT_TYPES = [
  'database',
  'schema',
  'table',
  'view',
  'materialized_view',
  'function',
  'procedure',
  'stage',
  'file_format',
  'task',
  'stream',
  'warehouse',
  'compute_pool',
  'role',
  'user',
  'network_rule',
  'integration',
  'secret',
  'tag',
] as const;

const ListObjectsSchema = z.object({
  objectType: z.enum(OBJECT_TYPES).describe('Type of object to list'),
  database: z.string().optional().describe('Database name'),
  schema: z.string().optional().describe('Schema name'),
  like: z.string().optional().describe('Pattern to match object names'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

const DescribeObjectSchema = z.object({
  objectType: z.enum(OBJECT_TYPES).describe('Type of object to describe'),
  objectName: z.string().describe('Name of the object'),
  database: z.string().optional().describe('Database name'),
  schema: z.string().optional().describe('Schema name'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

const GetDDLSchema = z.object({
  objectType: z.string().min(1).describe('Type of object (TABLE, VIEW, PROCEDURE, FUNCTION, etc.)'),
  objectName: z.string().min(1).describe('Name of the object'),
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

function buildScope(database?: string, schema?: string): string {
  if (database && schema) {
    return `${database}.${schema}`;
  }
  if (database) {
    return database;
  }
  return '';
}

function filterExcludedObjects<T extends { name?: string }>(
  objects: T[],
  exclusionChecker: (name: string) => { isExcluded: boolean; matchedPattern?: string }
): T[] {
  return objects.filter(obj => {
    const name = obj.name;
    if (!name) return true;
    const result = exclusionChecker(name);
    return !result.isExcluded;
  });
}

export async function listObjectsTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = ListObjectsSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E2000'
    );
  }
  
  const { objectType, database, schema, like, connection } = parsed.data;
  const config = getConfig();
  
  const exclusionChecker = createExclusionChecker(
    config.exclusions.patterns,
    config.exclusions.objectTypes
  );
  
  const scope = buildScope(database, schema);
  
  const args: string[] = ['object', 'list', objectType];
  
  if (scope) {
    args.push('--in', scope);
  }
  
  if (like) {
    args.push('--like', like);
  }
  
  args.push('--terse');
  
  const result = await executeSnowCLI(args, { connection });
  
  if (result.exitCode !== 0) {
    return createErrorResponse(
      'CLI_ERROR',
      result.stderr || 'Unknown error',
      'E2001'
    );
  }
  
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  
  if (lines.length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ objects: [], totalCount: 0 }) }],
    };
  }
  
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
  const objects = lines.slice(1).map(line => {
    const values = line.split('\t');
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = values[i]?.trim() || '';
    });
    return obj;
  });
  
  const filtered = filterExcludedObjects(objects, exclusionChecker.check.bind(exclusionChecker));
  
  return {
    content: [{ type: 'text', text: JSON.stringify({ 
      objects: filtered, 
      totalCount: filtered.length,
      _meta: { objectType, scope, like }
    }) }],
  };
}

export async function describeObjectTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = DescribeObjectSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E2000'
    );
  }
  
  const { objectType, objectName, database, schema, connection } = parsed.data;
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
      'E2002'
    );
  }
  
  const scope = buildScope(database, schema);
  const args: string[] = ['object', 'describe', objectType, objectName];
  
  if (scope) {
    args.push('--in', scope);
  }
  
  const result = await executeSnowCLI(args, { connection });
  
  if (result.exitCode !== 0) {
    return createErrorResponse(
      'CLI_ERROR',
      result.stderr || 'Unknown error',
      'E2003'
    );
  }
  
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  
  if (lines.length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ metadata: {}, _meta: { objectType, objectName } }) }],
    };
  }
  
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
  const columns = lines.slice(1).map(line => {
    const values = line.split('\t');
    const col: Record<string, string> = {};
    headers.forEach((header, i) => {
      col[header] = values[i]?.trim() || '';
    });
    return col;
  });
  
  return {
    content: [{ type: 'text', text: JSON.stringify({ 
      metadata: { columns },
      objectType,
      objectName,
      database,
      schema,
    }) }],
  };
}

export async function getDDLTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = GetDDLSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E2000'
    );
  }
  
  const { objectType, objectName, database, schema, connection } = parsed.data;
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
      'E2002'
    );
  }
  
  const fullName = [
    database || schema ? database : '',
    schema || '',
    objectName
  ].filter(Boolean).join('.');
  
  const normalizedType = objectType.toUpperCase().replace(' ', '_');
  
  const ddlQuery = `SHOW CREATE ${normalizedType} ${fullName}`;
  const result = await executeSQL(ddlQuery, { connection });
  
  if (result.exitCode !== 0) {
    return createErrorResponse(
      'CLI_ERROR',
      result.stderr || 'Unknown error',
      'E2004'
    );
  }
  
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  
  if (lines.length === 0) {
    return createErrorResponse(
      'OBJECT_NOT_FOUND',
      `Could not retrieve DDL for ${objectType} ${objectName}`,
      'E2005'
    );
  }
  
  let ddl = '';
  
  if (lines.length === 1) {
    const values = lines[0].split('\t');
    ddl = values[values.length - 1]?.trim() || '';
  } else {
    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
    const bodyIdx = headers.findIndex(h => h === 'body' || h === 'ddl' || h === 'statement');
    
    if (bodyIdx >= 0) {
      const dataLine = lines.find((line, i) => i > 0 && line.includes('\t'));
      if (dataLine) {
        const values = dataLine.split('\t');
        ddl = values[bodyIdx]?.trim() || '';
      }
    } else {
      ddl = lines.slice(1).join('\n').trim();
    }
  }
  
  return {
    content: [{ type: 'text', text: JSON.stringify({ 
      objectType: normalizedType,
      objectName,
      ddl,
      database,
      schema,
    }) }],
  };
}
