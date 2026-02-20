import { z } from 'zod';
import type { QueryToolResult, ErrorResponse } from '../types.js';
import { getConfig } from '../config.js';
import { classifyQuery, redactJsonResult, createExclusionChecker, extractObjectNames } from '../metadata-proxy/index.js';
import { executeSQL } from '../command-executor.js';

const ExecuteSQLSchema = z.object({
  query: z.string().min(1),
  connection: z.string().optional(),
});

const ExecuteScalarSchema = z.object({
  query: z.string().min(1),
  connection: z.string().optional(),
  limit: z.number().min(1).default(100),
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

export async function executeSqlTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = ExecuteSQLSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E1000'
    );
  }
  
  const { query, connection } = parsed.data;
  const config = getConfig();
  
  const objectNames = extractObjectNames(query);
  const exclusionChecker = createExclusionChecker(
    config.exclusions.patterns,
    config.exclusions.objectTypes
  );
  
  for (const obj of objectNames) {
    const checkResult = exclusionChecker.check(obj);
    if (checkResult.isExcluded) {
      return createErrorResponse(
        'EXCLUDED_OBJECT',
        `Object '${obj}' matches exclusion pattern '${checkResult.matchedPattern}'`,
        'E1001'
      );
    }
  }
  
  const queryType = classifyQuery(query);
  
  const result = await executeSQL(query, { connection });
  
  if (result.exitCode !== 0) {
    return createErrorResponse(
      'CLI_ERROR',
      result.stderr || 'Unknown error',
      'E1002'
    );
  }
  
  if (queryType.type === 'metadata' || queryType.type === 'data') {
    const redacted = redactJsonResult(result.stdout);
    return {
      content: [{ type: 'text', text: redacted }],
      _queryType: queryType.type,
    };
  }
  
  return {
    content: [{ type: 'text', text: result.stdout }],
    _queryType: queryType.type,
  };
}

export async function executeScalarTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = ExecuteScalarSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E1000'
    );
  }
  
  const { query, connection, limit } = parsed.data;
  const config = getConfig();
  
  const limitedQuery = addLimitIfNeeded(query, Math.min(limit, config.guardrail.maxScalarRows));
  
  const result = await executeSQL(limitedQuery, { connection });
  
  if (result.exitCode !== 0) {
    return createErrorResponse(
      'CLI_ERROR',
      result.stderr || 'Unknown error',
      'E1002'
    );
  }
  
  let rowCount = 0;
  try {
    const parsed = JSON.parse(result.stdout);
    rowCount = Array.isArray(parsed) ? parsed.length : 1;
  } catch {
    rowCount = result.stdout.split('\n').filter(Boolean).length;
  }
  
  return {
    content: [{ type: 'text', text: result.stdout }],
    _queryType: 'scalar',
    _rowCount: rowCount,
  };
}

function addLimitIfNeeded(query: string, limit: number): string {
  const upperQuery = query.toUpperCase();
  
  if (upperQuery.includes('LIMIT')) {
    return query;
  }
  
  return `${query} LIMIT ${limit}`;
}
