/**
 * TypeScript type definitions for Snowflake MCP Proxy Plugin
 */

/**
 * Plugin context passed by OpenCode
 */
export interface PluginContext {
  client: any
  project: any
  $: any
  directory: any
  worktree: any
}

/**
 * Column schema definition
 */
export interface ColumnSchema {
  name: string
  type: string
}

/**
 * VARIANT inference configuration
 */
export interface VariantInferenceConfig {
  enabled: boolean
  maxSampleSize: number
  samplingFormula: string
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  enabled: boolean
  logFile: string
  logLevel: string
}

/**
 * Snowflake query result from MCP server
 */
export interface SnowflakeQueryResult {
  rows: Array<Record<string, any>>
  columns?: Array<{name: string, type: string}>
  executionTime?: number
  [key: string]: any
}

/**
 * Metadata-only result returned to agent
 */
export interface MetadataOnlyResult {
  metadata: {
    schema: ColumnSchema[]
    rowCount: number
    nullCounts: Record<string, number>
    distinctCounts: Record<string, number>
    variantInterfaces?: Record<string, string>
  }
  rows: []  // Always empty - no row data returned
}

/**
 * Audit log entry
 */
export interface AuditEntry {
  sessionId: string
  requestNumber: number
  toolName: string
  sql: string
  queryType: 'DATA' | 'METADATA'
  status: 'executed' | 'blocked'
  exclusions: string[]
  destructive: boolean
  confirmationRequired: boolean
  metadata?: {
    schema: ColumnSchema[]
    rowCount: number
    nullCounts: Record<string, number>
    distinctCounts: Record<string, number>
    variantInterfaces?: Record<string, string>
  }
  executionTime?: number
  error?: string
}

/**
 * Result of exclusion check
 */
export interface ExclusionCheckResult {
  blocked: boolean
  reason?: string
}

/**
 * Result of before-tool handler
 */
export interface BeforeToolResult {
  blocked: boolean
  reason?: string
  modifiedArgs?: any
}

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  enabled: boolean
  skipPatterns: string[]
  exclusionPatterns: string[]
  requireConfirmation: {
    destructive: boolean
  }
  variantInference: VariantInferenceConfig
  logging: LoggingConfig
  snowflakeMcp: {
    configFile: string
    connectionName: string
  }
}
