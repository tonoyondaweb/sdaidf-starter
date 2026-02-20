import type { QueryClassification } from '../types.js';

const SCALAR_PATTERNS: RegExp[] = [
  /^\s*SELECT\s+(COUNT|SUM|AVG|MIN|MAX|COUNT_DISTINCT)\s*\(/i,
  /^\s*SELECT\s+(CURRENT_|SESSION_|SYSTEM\$)/i,
];

const METADATA_PATTERNS: RegExp[] = [
  /^\s*SELECT\s+.*\s+FROM\s+INFORMATION_SCHEMA/i,
  /^\s*SELECT\s+.*\s+FROM\s+DATA_/i,
  /DESCRIBE\s+/i,
  /SHOW\s+/i,
  /LIST\s+/i,
  /^DESC(RIPE)?\s+/i,
  /GET_DDL\s*\(/i,
  /GET\s+DDL/i,
];

export function classifyQuery(query: string): QueryClassification {
  const trimmedQuery = query.trim();
  
  for (const pattern of METADATA_PATTERNS) {
    if (pattern.test(trimmedQuery)) {
      return {
        type: 'metadata',
        reason: `Query matches metadata pattern: ${pattern.source}`,
      };
    }
  }
  
  for (const pattern of SCALAR_PATTERNS) {
    if (pattern.test(trimmedQuery)) {
      return {
        type: 'scalar',
        reason: `Query matches scalar pattern: ${pattern.source}`,
      };
    }
  }
  
  return {
    type: 'data',
    reason: 'Query does not match any known patterns, treating as data query',
  };
}

export function isScalarQuery(query: string): boolean {
  return classifyQuery(query).type === 'scalar';
}

export function isMetadataQuery(query: string): boolean {
  return classifyQuery(query).type === 'metadata';
}

export function isDataQuery(query: string): boolean {
  return classifyQuery(query).type === 'data';
}
