export type QueryType = 'metadata' | 'scalar' | 'data';

export interface QueryClassification {
  type: QueryType;
  reason: string;
}

export interface ExclusionConfig {
  patterns: RegExp[];
  objectTypes: string[];
}

export interface ExclusionResult {
  isExcluded: boolean;
  matchedPattern?: string;
}

export interface RedactedResult {
  metadata: {
    columns: ColumnInfo[];
    rowCount: number;
  };
  data: Record<string, unknown>[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface CLIExecutionOptions {
  connection?: string;
  warehouse?: string;
  role?: string;
}

export interface QueryMetadata {
  queryId?: string;
  queryText: string;
  connectionName: string;
  timestamp: string;
  executionTimeMs?: number;
  queryOutput?: string;
}

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  queryMetadata?: QueryMetadata;
}

export interface QueryToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  _queryType?: QueryType;
  _rowCount?: number;
}

export interface ErrorResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError: true;
  error: string;
  code: string;
}

export interface ProjectConfig {
  project: {
    name: string;
    version: string;
  };
  exclusions: ExclusionConfig;
  snowcli: {
    connection: string;
    defaults: {
      warehouse?: string;
      role?: string;
    };
  };
  guardrail: {
    maxScalarRows: number;
    variantAnalysis: {
      sampleSize: number;
    };
  };
  sync: {
    targetDir: string;
  };
}

export const OBJECT_TYPES = [
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

export type ObjectType = (typeof OBJECT_TYPES)[number];
