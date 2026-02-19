# Snowflake MCP Proxy Plugin - Implementation Plan

**Version**: 1.0
**Date**: February 19, 2026
**Status**: Ready for Implementation

---

## Overview

This document provides a detailed implementation plan for building a Snowflake MCP Proxy Plugin that intercepts Snowflake Labs MCP tool calls, strips row data from responses, and enforces safety guards while ensuring no production data is ever exposed to AI agents.

### Goals

1. **Privacy Preservation**: Ensure no actual row data is ever returned to agents
2. **Safety Guards**: Block access to protected objects and require confirmation for destructive operations
3. **Metadata Only**: Return only schema and metadata (including TypeScript interfaces for VARIANT columns)
4. **Complete Audit**: Log all interactions in Markdown format
5. **No Bypass**: Intercept all Snowflake tool calls at the OpenCode level

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent                          │
│  (developer, planner, orchestrator, tester, etc.)   │
└────────────────────┬──────────────────────────────────────┘
                     │
                     │ Tool Call (e.g., snowflake_execute_sql)
                     ↓
┌─────────────────────────────────────────────────────────────┐
│           OpenCode Tool Execution Layer                   │
│  - tool.execute.before hook                              │
│  - tool.execute.after hook                               │
└────────────────────┬──────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│         Snowflake Proxy Plugin (TypeScript)               │
│  ┌──────────────────────────────────────────────────┐      │
│  │ tool.execute.before:                             │      │
│  │ 1. Discover Snowflake tools (via client API)    │      │
│  │ 2. Check if tool should be intercepted          │      │
│  │ 3. Extract SQL query / parameters               │      │
│  │ 4. Classify query type (DATA vs METADATA)      │      │
│  │ 5. Check exclusion patterns                      │      │
│  │ 6. Detect destructive operations                │      │
│  │ 7. Request confirmation (if needed)             │      │
│  │ 8. Log request                               │      │
│  └──────────────────────────────────────────────────┘      │
│                     ↓                                  │
│  ┌──────────────────────────────────────────────────┐      │
│  │ Snowflake Labs MCP Server (external)            │      │
│  │ - Managed by OpenCode                         │      │
│  │ - Started via uvx command                    │      │
│  │ - Accesses Snowflake via Python connector       │      │
│  └──────────────────────────────────────────────────┘      │
│                     ↓                                  │
│  ┌──────────────────────────────────────────────────┐      │
│  │ tool.execute.after:                              │      │
│  │ 1. Extract result from MCP server               │      │
│  │ 2. Check if row data stripping needed           │      │
│  │ 3. For DATA queries:                         │      │
│  │    a. Strip all row data                       │      │
│  │    b. Extract metadata (schema, stats)          │      │
│  │    c. Detect VARIANT columns                   │      │
│  │    d. Infer TypeScript interfaces               │      │
│  │    e. Perform adaptive sampling (sqrt formula)  │      │
│  │ 4. For METADATA queries:                      │      │
│  │    a. Pass through unchanged                   │      │
│  │ 5. Replace output with metadata-only version     │      │
│  │ 6. Log response                             │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
                     ↓
Agent (receives metadata only, never row data)
```

---

## File Structure

```
.opencode/
├── plugins/
│   └── snowflake-mcp-proxy/
│       ├── index.ts                      # Main plugin entry point
│       ├── query-classifier.ts           # Query classification logic
│       ├── row-data-stripper.ts          # Row data stripping & metadata extraction
│       ├── variant-inference.ts          # VARIANT column TypeScript interface inference
│       ├── exclusion-checker.ts        # Pattern matching for protected objects
│       ├── destructive-detector.ts      # Detect destructive operations
│       ├── tool-discovery.ts           # Discover Snowflake MCP tools
│       ├── config-loader.ts            # Load proxy and Snowflake configs
│       ├── audit-logger.ts             # Markdown audit logging
│       ├── utils.ts                    # Helper functions
│       ├── types.ts                    # TypeScript type definitions
│       └── README.md                   # Plugin documentation
└── package.json                       # Plugin dependencies

.snowflake-proxy/                      # Project-specific config
├── config.yaml                         # Proxy configuration
└── logs/
    └── audit.md                        # Audit trail (auto-created)
```

---

## Component Specifications

### 1. Main Plugin (`index.ts`)

**Purpose**: Plugin entry point that registers hooks with OpenCode

**Responsibilities**:
- Load configuration on initialization
- Initialize audit logger
- Discover Snowflake MCP tools via OpenCode client API
- Register `tool.execute.before` and `tool.execute.after` hooks
- Route intercepted calls to appropriate handlers

**Key Code Structure**:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const SnowflakeMCPProxyPlugin: Plugin = async (ctx) => {
  // Load configuration
  const config = await configLoader.load()
  if (!config.enabled) return {}

  // Initialize audit logger
  const logger = new AuditLogger(config.logging)

  // Discover Snowflake MCP tools
  const snowflakeTools = await discoverSnowflakeTools(ctx.client)

  return {
    "tool.execute.before": async (input, output) => {
      // Skip non-Snowflake tools
      if (!shouldIntercept(input.tool, snowflakeTools, config.skipPatterns)) {
        return
      }

      // Extract SQL query from arguments (if present)
      const sql = extractSqlFromArgs(input.tool, output.args)

      const result = await beforeToolHandler(
        input.tool,
        sql,
        output.args,
        config,
        logger,
        ctx
      )

      // Block execution if needed
      if (result.blocked) {
        throw new Error(result.reason)
      }

      // Modify arguments if needed
      if (result.modifiedArgs) {
        output.args = result.modifiedArgs
      }
    },

    "tool.execute.after": async (input, output) => {
      if (!shouldIntercept(input.tool, snowflakeTools, config.skipPatterns)) {
        return
      }

      const modifiedOutput = await afterToolHandler(
        input.tool,
        input.args,
        output.output,
        config,
        logger
      )

      // Replace output with metadata-only version
      output.output = modifiedOutput
    }
  }
}
```

**Dependencies**:
- `config-loader.ts`
- `audit-logger.ts`
- `tool-discovery.ts`
- `query-classifier.ts`
- `exclusion-checker.ts`
- `destructive-detector.ts`

---

### 2. Query Classifier (`query-classifier.ts`)

**Purpose**: Classify SQL queries into DATA vs METADATA

**Classification Rules**:
- **DATA queries**: ALL SELECT statements (including `SELECT COUNT(*)`, scalar queries)
- **METADATA queries**: All other SQL (DDL, DML, DESCRIBE, SHOW, etc.)

**Key Code Structure**:

```typescript
export enum QueryType {
  DATA,      // SELECT queries - ALL variants
  METADATA   // DDL, DML, SHOW, DESCRIBE, etc.
}

export function classifyQuery(sql: string): QueryType {
  const firstWord = extractFirstKeyword(sql).toUpperCase()

  // ALL SELECT queries are DATA queries (must be intercepted)
  if (firstWord === 'SELECT') {
    return QueryType.DATA
  }

  // Everything else is metadata
  return QueryType.METADATA
}

function extractFirstKeyword(sql: string): string {
  const trimmed = sql.trim()
  const match = trimmed.match(/^(\w+)/)
  return match ? match[1] : ''
}
```

**Test Cases**:
| Query | Type | Reason |
|-------|------|---------|
| `SELECT * FROM table` | DATA | SELECT query |
| `SELECT COUNT(*) FROM table` | DATA | SELECT query (even scalar) |
| `CREATE TABLE t (...)` | METADATA | DDL |
| `DROP TABLE t` | METADATA | DDL (but destructive) |
| `INSERT INTO t VALUES (...)` | METADATA | DML |
| `DESCRIBE TABLE t` | METADATA | Metadata command |

---

### 3. Row Data Stripper (`row-data-stripper.ts`)

**Purpose**: Strip all row data from query results and extract metadata

**Input/Output**:

```typescript
// Input: Result from Snowflake MCP tool
interface SnowflakeQueryResult {
  rows: Array<Record<string, any>>
  columns?: Array<{name: string, type: string}>
  executionTime?: number
  [key: string]: any
}

// Output: Metadata only
interface MetadataOnlyResult {
  metadata: {
    schema: Array<{name: string, type: string}>
    rowCount: number
    nullCounts: Record<string, number>
    distinctCounts: Record<string, number>
    variantInterfaces?: Record<string, string>  // TypeScript interfaces
  }
  rows: []  // Always empty
}
```

**Key Code Structure**:

```typescript
export async function stripRowData(
  result: SnowflakeQueryResult,
  config: ProxyConfig,
  ctx: PluginContext
): Promise<MetadataOnlyResult> {
  // Handle empty results
  if (!result.rows || result.rows.length === 0) {
    return {
      metadata: {
        schema: result.columns || [],
        rowCount: 0,
        nullCounts: {},
        distinctCounts: {}
      },
      rows: []
    }
  }

  // Extract schema
  const schema = result.columns || extractSchemaFromFirstRow(result.rows[0])

  // Calculate statistics
  const rowCount = result.rows.length
  const nullCounts = calculateNullCounts(result.rows)
  const distinctCounts = calculateDistinctCounts(result.rows)

  // Process VARIANT columns
  const variantColumns = schema.filter(col =>
    col.type.toUpperCase() === 'VARIANT'
  )

  const variantInterfaces: Record<string, string> = {}

  for (const variantCol of variantColumns) {
    const interface = await inferVariantInterface(
      variantCol.name,
      result.rows,
      config.variantInference,
      ctx
    )
    if (interface) {
      variantInterfaces[variantCol.name] = interface
    }
  }

  return {
    metadata: {
      schema,
      rowCount,
      nullCounts,
      distinctCounts,
      variantInterfaces
    },
    rows: []  // NO ROW DATA RETURNED
  }
}

function extractSchemaFromFirstRow(row: Record<string, any>): ColumnSchema[] {
  return Object.entries(row).map(([name, value]) => ({
    name,
    type: typeof value
  }))
}

function calculateNullCounts(rows: Array<Record<string, any>>): Record<string, number> {
  if (rows.length === 0) return {}

  const nullCounts: Record<string, number> = {}

  Object.keys(rows[0]).forEach(col => {
    nullCounts[col] = rows.filter(row => row[col] === null || row[col] === undefined).length
  })

  return nullCounts
}

function calculateDistinctCounts(rows: Array<Record<string, any>>): Record<string, number> {
  if (rows.length === 0) return {}

  const distinctCounts: Record<string, number> = {}

  Object.keys(rows[0]).forEach(col => {
    const distinctValues = new Set(rows.map(row => row[col]))
    distinctCounts[col] = distinctValues.size
  })

  return distinctCounts
}
```

---

### 4. VARIANT Inference (`variant-inference.ts`)

**Purpose**: Infer TypeScript interfaces from VARIANT column data

**Sampling Formula**:
```
sampleSize = min(1000, floor(sqrt(totalRows)))
```

**Key Code Structure**:

```typescript
export async function inferVariantInterface(
  columnName: string,
  rows: Array<Record<string, any>>,
  config: VariantInferenceConfig,
  ctx: PluginContext
): Promise<string | null> {
  // Extract VARIANT values
  const variantValues = rows
    .map(row => row[columnName])
    .filter(v => v !== null && v !== undefined)

  if (variantValues.length === 0) {
    return null
  }

  // Calculate sample size using square root formula
  const totalRows = variantValues.length
  const sampleSize = Math.min(
    config.maxSampleSize,
    Math.floor(Math.sqrt(totalRows))
  )

  // Sample values
  const samples = sampleValues(variantValues, sampleSize)

  // Parse JSON if needed (VARIANT stores as strings or objects)
  const parsedSamples = samples.map(sample => {
    if (typeof sample === 'string') {
      try {
        return JSON.parse(sample)
      } catch {
        return null
      }
    }
    return sample
  }).filter(s => s !== null)

  if (parsedSamples.length === 0) {
    return null
  }

  // Infer TypeScript interface
  const interface = inferTypeScriptInterface(parsedSamples)

  return interface
}

function sampleValues<T>(values: T[], count: number): T[] {
  if (values.length <= count) {
    return values
  }

  // Simple random sampling
  const shuffled = [...values].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function inferTypeScriptInterface(samples: any[]): string {
  // Use json-schema-to-typescript or custom inference
  const jsonSchema = inferJsonSchema(samples)

  // Convert to TypeScript
  const typescriptInterface = jsonSchemaToTypeScript(jsonSchema)

  return typescriptInterface
}

function inferJsonSchema(samples: any[]): object {
  // Custom or library-based JSON schema inference
  // Handles nested objects, arrays, optional fields, etc.

  const schema = {
    type: 'object',
    properties: {} as Record<string, any>,
    required: [] as string[]
  }

  // Analyze all samples to build comprehensive schema
  samples.forEach(sample => {
    if (typeof sample !== 'object' || sample === null) return

    Object.entries(sample).forEach(([key, value]) => {
      if (!schema.properties[key]) {
        schema.properties[key] = inferType(value)
        schema.required.push(key)
      } else {
        // Merge with existing property type
        schema.properties[key] = mergeTypes(schema.properties[key], inferType(value))
      }
    })
  })

  return schema
}

function inferType(value: any): any {
  if (value === null) return { type: 'null' }

  const type = typeof value

  switch (type) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'object':
      if (Array.isArray(value)) {
        if (value.length > 0) {
          return {
            type: 'array',
            items: inferType(value[0])
          }
        }
        return { type: 'array' }
      }
      return inferJsonSchema([value])
    default:
      return { type: 'any' }
  }
}

function mergeTypes(existing: any, newType: any): any {
  // Handle union types, optional fields, etc.
  // Simplified implementation
  if (JSON.stringify(existing) === JSON.stringify(newType)) {
    return existing
  }

  return {
    oneOf: [existing, newType]
  }
}
```

**Example Output**:
```typescript
interface Metadata {
  source?: string;
  tags?: string[];
  priority?: number;
  nested?: {
    level1?: {
      level2?: string;
    };
  };
}
```

---

### 5. Exclusion Checker (`exclusion-checker.ts`)

**Purpose**: Check if a query references protected objects

**Configuration Patterns**:
```yaml
exclusion_patterns:
  - "PROD\\..*"
  - ".*_PROD"
  - ".*_BACKUP"
  - ".*_HISTORY"
  - ".*_ARCHIVE"
```

**Key Code Structure**:

```typescript
export function checkExclusions(
  sql: string,
  patterns: string[]
): {blocked: boolean, reason?: string} {
  const objects = extractObjectReferences(sql)

  for (const obj of objects) {
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i')
        if (regex.test(obj)) {
          return {
            blocked: true,
            reason: `Query blocked: Object '${obj}' matches exclusion pattern '${pattern}'`
          }
        }
      } catch (error) {
        console.error(`Invalid regex pattern: ${pattern}`, error)
      }
    }
  }

  return { blocked: false }
}

function extractObjectReferences(sql: string): string[] {
  const objects: Set<string> = new Set()

  // Regex patterns to extract object references
  const patterns = [
    /FROM\s+([^\s,;]+)/gi,
    /JOIN\s+([^\s,;]+)/gi,
    /UPDATE\s+([^\s,;]+)/gi,
    /INSERT\s+INTO\s+([^\s,(;]+)/gi,
    /DELETE\s+FROM\s+([^\s,;]+)/gi,
    /TRUNCATE\s+TABLE\s+([^\s,;]+)/gi,
    /MERGE\s+INTO\s+([^\s,;]+)/gi,
    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([^\s,(;]+)/gi,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?([^\s,;]+)/gi,
    /ALTER\s+TABLE\s+([^\s,;]+)/gi,
    /DESCRIBE\s+TABLE\s+([^\s,;]+)/gi
  ]

  patterns.forEach(pattern => {
    let match
    while ((match = pattern.exec(sql)) !== null) {
      // Extract object name (may be fully qualified: db.schema.table)
      const objectRef = match[1].trim()
      objects.add(objectRef)
    }
  })

  return Array.from(objects)
}
```

**Test Cases**:
| Query | Patterns | Blocked? | Reason |
|-------|-----------|------------|---------|
| `SELECT * FROM PROD.orders` | `PROD\\..*` | ✅ | Matches pattern |
| `SELECT * FROM analytics.orders` | `PROD\\..*` | ❌ | No match |
| `SELECT * FROM orders_PROD` | `.*_PROD` | ✅ | Matches pattern |
| `SELECT * FROM orders_backup` | `.*_BACKUP` | ✅ | Matches pattern |
| `SELECT * FROM staging.orders` | All | ❌ | No match |

---

### 6. Destructive Detector (`destructive-detector.ts`)

**Purpose**: Detect operations that modify or destroy data

**Destructive Operations**:
- DROP
- TRUNCATE
- DELETE
- ALTER TABLE
- MERGE

**Key Code Structure**:

```typescript
export function isDestructive(sql: string): boolean {
  const upperSql = sql.toUpperCase()

  const destructivePatterns = [
    /\bDROP\s+(TABLE|VIEW|DATABASE|SCHEMA|WAREHOUSE|ROLE|USER|STAGE|FUNCTION|PROCEDURE)/i,
    /\bTRUNCATE\s+TABLE/i,
    /\bDELETE\s+FROM/i,
    /\bALTER\s+TABLE/i,
    /\bMERGE\s+INTO/i
  ]

  return destructivePatterns.some(pattern => pattern.test(upperSql))
}

export async function requestConfirmation(
  sql: string,
  toolName: string,
  ctx: PluginContext
): Promise<boolean> {
  try {
    const confirmed = await ctx.client.permission.ask({
      tool: toolName,
      action: "Destructive operation",
      message: `This query will modify or destroy data:\n\n${sql}\n\nConfirm to proceed?`
    })

    return confirmed
  } catch (error) {
    console.error('Error requesting confirmation:', error)
    return false
  }
}
```

**Test Cases**:
| Query | Destructive? |
|-------|---------------|
| `DROP TABLE t` | ✅ |
| `TRUNCATE TABLE t` | ✅ |
| `DELETE FROM t WHERE id=1` | ✅ |
| `ALTER TABLE t ADD COLUMN c` | ✅ |
| `MERGE INTO t USING s ON t.id=s.id ...` | ✅ |
| `CREATE TABLE t (...)` | ❌ |
| `INSERT INTO t VALUES (...)` | ❌ |
| `UPDATE t SET x=1 WHERE id=1` | ❌ |
| `SELECT * FROM t` | ❌ |

---

### 7. Tool Discovery (`tool-discovery.ts`)

**Purpose**: Auto-discover available Snowflake MCP tools using OpenCode client API

**OpenCode API Endpoints**:
- `client.tool.list()` - List all tools with JSON schema
- `client.tool.ids()` - List all tool IDs

**Key Code Structure**:

```typescript
import type { Client } from "@opencode-ai/sdk"

export async function discoverSnowflakeTools(
  client: Client
): Promise<string[]> {
  try {
    // Get all available tools from OpenCode
    const toolsResponse = await client.tool.list({
      query: {
        provider: "snowflake",  // Filter by Snowflake provider
        model: "*"  // All models
      }
    })

    if (!toolsResponse.data) {
      console.warn('No tools found via OpenCode client API')
      return []
    }

    const allTools = toolsResponse.data.map(t => t.id)

    // Filter for Snowflake tools (not cortex_*)
    const snowflakeTools = allTools.filter(tool =>
      tool.startsWith('snowflake_') && !tool.startsWith('cortex_')
    )

    console.log(`Discovered ${snowflakeTools.length} Snowflake MCP tools`)

    return snowflakeTools
  } catch (error) {
    console.error('Error discovering Snowflake tools:', error)
    return []
  }
}

export function shouldIntercept(
  toolName: string,
  discoveredTools: string[],
  skipPatterns: string[]
): boolean {
  // Skip cortex_* tools
  if (skipPatterns.some(pattern => new RegExp(pattern).test(toolName))) {
    return false
  }

  // Intercept all discovered Snowflake tools
  return discoveredTools.includes(toolName)
}
```

**Fallback Approach**:
If OpenCode client API is not available or fails, use pattern-based discovery:

```typescript
export async function discoverSnowflakeToolsFallback(): Promise<string[]> {
  // Known Snowflake MCP tool patterns
  const knownPatterns = [
    'snowflake_execute_sql',
    'snowflake_list_databases',
    'snowflake_list_schemas',
    'snowflake_list_tables',
    'snowflake_describe_table',
    'snowflake_create_table',
    'snowflake_drop_table',
    'snowflake_alter_table',
    'snowflake_insert',
    'snowflake_update',
    'snowflake_delete',
    'snowflake_truncate_table',
    'snowflake_merge',
    'snowflake_list_views',
    'snowflake_create_view',
    'snowflake_drop_view',
    'snowflake_describe_view'
  ]

  return knownPatterns
}
```

---

### 8. Configuration Loader (`config-loader.ts`)

**Purpose**: Load proxy and Snowflake connection configurations

**Configuration Files**:
1. Proxy config: `.snowflake-proxy/config.yaml`
2. Snowflake config: `~/.snowflake/config.toml` (standard location)

**Config Structure**:

```yaml
# .snowflake-proxy/config.yaml
proxy:
  enabled: true

  # Tools to skip
  skip_patterns:
    - "cortex_*"

  # Exclusion patterns for protected objects
  exclusion_patterns:
    - "PROD\\..*"
    - ".*_PROD"
    - ".*_BACKUP"
    - ".*_HISTORY"
    - ".*_ARCHIVE"

  # Destructive operation confirmation
  require_confirmation:
    destructive: true

  # VARIANT inference settings
  variant_inference:
    enabled: true
    max_sample_size: 1000
    sampling_formula: "sqrt"

  # Logging
  logging:
    enabled: true
    log_file: ".snowflake-proxy/logs/audit.md"
    log_level: "info"

  # Snowflake MCP server
  snowflake_mcp:
    config_file: "mcp-snowflake-config.yaml"
    connection_name: "default"
```

**Key Code Structure**:

```typescript
import * as yaml from 'yaml'
import * as toml from 'toml'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export interface ProxyConfig {
  enabled: boolean
  skipPatterns: string[]
  exclusionPatterns: string[]
  requireConfirmation: {
    destructive: boolean
  }
  variantInference: {
    enabled: boolean
    maxSampleSize: number
    samplingFormula: string
  }
  logging: {
    enabled: boolean
    logFile: string
    logLevel: string
  }
  snowflakeMcp: {
    configFile: string
    connectionName: string
  }
}

export async function loadProxyConfig(): Promise<ProxyConfig> {
  const configPath = path.join(process.cwd(), '.snowflake-proxy', 'config.yaml')

  try {
    const configFile = await fs.readFile(configPath, 'utf-8')
    const config = yaml.parse(configFile)

    return config.proxy
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`Config file not found: ${configPath}`)
      console.warn('Using default configuration')
      return getDefaultConfig()
    }
    throw error
  }
}

export async function loadSnowflakeConnectionConfig(): Promise<any> {
  const configPath = path.join(os.homedir(), '.snowflake', 'config.toml')

  try {
    const configFile = await fs.readFile(configPath, 'utf-8')
    const config = toml.parse(configFile)
    return config
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`Snowflake config not found: ${configPath}`)
      return {}
    }
    throw error
  }
}

function getDefaultConfig(): ProxyConfig {
  return {
    enabled: true,
    skipPatterns: ['cortex_*'],
    exclusionPatterns: [],
    requireConfirmation: {
      destructive: true
    },
    variantInference: {
      enabled: true,
      maxSampleSize: 1000,
      samplingFormula: 'sqrt'
    },
    logging: {
      enabled: true,
      logFile: '.snowflake-proxy/logs/audit.md',
      logLevel: 'info'
    },
    snowflakeMcp: {
      configFile: 'mcp-snowflake-config.yaml',
      connectionName: 'default'
    }
  }
}
```

---

### 9. Audit Logger (`audit-logger.ts`)

**Purpose**: Log all Snowflake tool interactions in Markdown format

**Log Format**:

```markdown
# Snowflake Proxy Audit Log

---

## Session: {{sessionId}} | {{timestamp}}

### Request #{{requestNumber}}

**Tool**: `{{toolName}}`

**Query**:
```sql
{{sql}}
```

**Type**: {{DATA|METADATA}}

**Status**: {{✅ Executed | ❌ Blocked}}

**Exclusions**: {{matches or "None"}}

**Destructive**: {{Yes|No}}

**Confirmation**: {{Required|Not required}}

#### Metadata Returned

**Schema**:
| Column | Type | Null Count | Distinct Count |
|--------|------|------------|----------------|
| {{col1}} | {{type1}} | {{null1}} | {{distinct1}} |
| {{col2}} | {{type2}} | {{null2}} | {{distinct2}} |

**Row Count**: {{rowCount}}

**Execution Time**: {{executionTime}}ms

{{#if variantInterfaces}}
#### VARIANT Column Interfaces

{{#each variantInterfaces}}
**Column: `{{@key}}`**
```typescript
{{this}}
```
{{/each}}
{{/if}}

{{#if error}}
#### Error
```
{{error}}
```
{{/if}}

---
```

**Key Code Structure**:

```typescript
import * as fs from 'fs/promises'
import * as path from 'path'

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

export class AuditLogger {
  constructor(private config: LoggingConfig) {}

  async log(entry: AuditEntry): Promise<void> {
    if (!this.config.enabled) return

    const logLine = this.formatMarkdown(entry)

    await fs.mkdir(path.dirname(this.config.logFile), { recursive: true })
    await fs.appendFile(this.config.logFile, logLine + '\n\n')
  }

  private formatMarkdown(entry: AuditEntry): string {
    const timestamp = new Date().toISOString()
    const statusIcon = entry.status === 'executed' ? '✅' : '❌'

    let md = `## Session: ${entry.sessionId} | ${timestamp}\n\n`
    md += `### Request #${entry.requestNumber}\n\n`
    md += `**Tool**: \`${entry.toolName}\`\n\n`

    if (entry.sql) {
      md += `**Query**:\n\`\`\`sql\n${entry.sql}\n\`\`\`\n\n`
    }

    md += `**Type**: ${entry.queryType}\n\n`
    md += `**Status**: ${statusIcon} ${entry.status}\n\n`

    if (entry.exclusions.length > 0) {
      md += `**Exclusions**:\n`
      entry.exclusions.forEach(ex => {
        md += `- ${ex}\n`
      })
      md += '\n'
    } else {
      md += `**Exclusions**: None\n\n`
    }

    md += `**Destructive**: ${entry.destructive ? 'Yes' : 'No'}\n\n`
    md += `**Confirmation**: ${entry.confirmationRequired ? 'Required' : 'Not required'}\n\n`

    if (entry.status === 'executed' && entry.metadata) {
      md += `#### Metadata Returned\n\n`
      md += `**Schema**:\n`
      md += `| Column | Type | Null Count | Distinct Count |\n`
      md += `|--------|------|------------|----------------|\n`

      entry.metadata.schema.forEach(col => {
        const nullCount = entry.metadata!.nullCounts[col.name] || 0
        const distinctCount = entry.metadata!.distinctCounts[col.name] || 0
        md += `| ${col.name} | ${col.type} | ${nullCount} | ${distinctCount} |\n`
      })

      md += '\n'
      md += `**Row Count**: ${entry.metadata.rowCount}\n\n`

      if (entry.executionTime) {
        md += `**Execution Time**: ${entry.executionTime}ms\n\n`
      }

      if (entry.metadata.variantInterfaces && Object.keys(entry.metadata.variantInterfaces).length > 0) {
        md += `#### VARIANT Column Interfaces\n\n`

        Object.entries(entry.metadata.variantInterfaces).forEach(([col, iface]) => {
          md += `**Column**: \`${col}\`\n\n`
          md += `\`\`\`typescript\n${iface}\n\`\`\`\n\n`
        })
      }
    }

    if (entry.error) {
      md += `#### Error\n\n`
      md += `\`\`\`\n${entry.error}\n\`\`\`\n\n`
    }

    return md
  }
}
```

---

### 10. Utils (`utils.ts`)

**Purpose**: Helper functions

**Key Functions**:

```typescript
export function extractSqlFromArgs(toolName: string, args: any): string | null {
  // Different tools may pass SQL in different argument names
  const sqlArgs = ['query', 'sql', 'statement', 'command']

  for (const arg of sqlArgs) {
    if (args && args[arg] && typeof args[arg] === 'string') {
      return args[arg]
    }
  }

  return null
}

export function formatSql(sql: string): string {
  // Format SQL for display (basic)
  return sql.trim()
}

export function sanitizeForMarkdown(text: string): string {
  // Escape special Markdown characters
  return text
    .replace(/\|/g, '\\|')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
}
```

---

### 11. Types (`types.ts`)

**Purpose**: TypeScript type definitions

```typescript
export interface PluginContext {
  client: any
  project: any
  $: any
  directory: any
  worktree: any
}

export interface ColumnSchema {
  name: string
  type: string
}

export interface VariantInferenceConfig {
  enabled: boolean
  maxSampleSize: number
  samplingFormula: string
}

export interface LoggingConfig {
  enabled: boolean
  logFile: string
  logLevel: string
}

export interface SnowflakeQueryResult {
  rows: Array<Record<string, any>>
  columns?: Array<{name: string, type: string}>
  executionTime?: number
  [key: string]: any
}

export interface MetadataOnlyResult {
  metadata: {
    schema: ColumnSchema[]
    rowCount: number
    nullCounts: Record<string, number>
    distinctCounts: Record<string, number>
    variantInterfaces?: Record<string, string>
  }
  rows: []
}
```

---

## Dependencies

**`.opencode/package.json`**:

```json
{
  "dependencies": {
    "yaml": "^2.3.4",
    "toml": "^3.0.0"
  }
}
```

**Note**: `@opencode-ai/plugin` and `@opencode-ai/sdk` are already available in the OpenCode environment.

---

## Implementation Phases

### Phase 1: Core Infrastructure (Foundation)

**Tasks**:
1. [ ] Create plugin directory structure
2. [ ] Implement `types.ts` - TypeScript definitions
3. [ ] Implement `utils.ts` - Helper functions
4. [ ] Implement `config-loader.ts` - Configuration loading
5. [ ] Create default configuration file template
6. [ ] Implement `audit-logger.ts` - Markdown logging
7. [ ] Write `README.md` with usage instructions

**Deliverables**:
- Type-safe configuration system
- Working audit logger
- Documentation

**Estimated Time**: 2-3 hours

---

### Phase 2: Tool Discovery and Classification

**Tasks**:
1. [ ] Implement `tool-discovery.ts` - Discover Snowflake MCP tools via OpenCode client API
2. [ ] Implement fallback pattern-based discovery
3. [ ] Implement `query-classifier.ts` - SQL query classification
4. [ ] Write unit tests for query classifier

**Deliverables**:
- Automatic tool discovery
- Accurate query classification

**Estimated Time**: 2-3 hours

---

### Phase 3: Safety Guards

**Tasks**:
1. [ ] Implement `exclusion-checker.ts` - Pattern matching
2. [ ] Implement `destructive-detector.ts` - Destructive operation detection
3. [ ] Implement confirmation request using OpenCode's `permission.ask`
4. [ ] Write unit tests for safety guards

**Deliverables**:
- Exclusion pattern enforcement
- Destructive operation blocking with confirmation

**Estimated Time**: 3-4 hours

---

### Phase 4: Response Transformation

**Tasks**:
1. [ ] Implement `row-data-stripper.ts` - Strip row data, extract metadata
2. [ ] Implement `variant-inference.ts` - TypeScript interface inference with adaptive sampling
3. [ ] Write unit tests for row data stripper
4. [ ] Write unit tests for VARIANT inference

**Deliverables**:
- Complete row data stripping
- TypeScript interface inference for VARIANT columns

**Estimated Time**: 4-5 hours

---

### Phase 5: Main Plugin Integration

**Tasks**:
1. [ ] Implement `index.ts` - Main plugin entry point
2. [ ] Integrate all modules
3. [ ] Register hooks with OpenCode
4. [ ] Implement before/after tool handlers

**Deliverables**:
- Complete, working proxy plugin

**Estimated Time**: 2-3 hours

---

### Phase 6: Testing and Documentation

**Tasks**:
1. [ ] Integration testing with actual Snowflake MCP server
2. [ ] End-to-end testing with agent workflows
3. [ ] Performance testing (large queries, many VARIANT samples)
4. [ ] Error handling and edge cases
5. [ ] Update README with examples
6. [ ] Create troubleshooting guide

**Deliverables**:
- Thoroughly tested plugin
- Complete documentation

**Estimated Time**: 4-5 hours

---

## Testing Strategy

### Unit Tests

Each module should have unit tests covering:

**Query Classifier**:
- All SQL statement types (SELECT, CREATE, DROP, etc.)
- Edge cases (empty queries, comments, whitespace)
- Complex queries (subqueries, CTEs, JOINs)

**Exclusion Checker**:
- Various regex patterns
- Fully qualified object names
- Multiple object references in single query

**Destructive Detector**:
- All destructive keyword patterns
- False negatives/positives

**Row Data Stripper**:
- Empty result sets
- Various data types
- Null handling
- Statistics calculation

**VARIANT Inference**:
- Different sampling sizes
- Various JSON structures
- Nested objects and arrays
- Optional fields

---

### Integration Tests

Test complete query flows:

1. **DATA query with VARIANT columns**:
   - Execute SELECT
   - Verify row data stripped
   - Verify metadata returned
   - Verify TypeScript interface inferred

2. **Blocked query (exclusion pattern)**:
   - Query protected object
   - Verify blocked with error

3. **Destructive operation**:
   - Execute DROP TABLE
   - Verify confirmation requested
   - Verify proceeds only after confirmation

4. **METADATA query**:
   - Execute CREATE TABLE
   - Verify result passed through unchanged

---

### End-to-End Tests

Test with actual agent workflows:

1. **Discovery agent**:
   - Run snowflake_sync
   - Verify no row data exposed
   - Verify audit log created

2. **Developer agent**:
   - Create table
   - Insert data
   - Query data
   - Verify all queries intercepted
   - Verify no row data in responses

---

## Error Handling

### Common Error Scenarios

1. **Configuration file not found**:
   - Use default configuration
   - Log warning
   - Continue with defaults

2. **Invalid regex patterns**:
   - Log error with pattern
   - Skip invalid pattern
   - Continue with remaining patterns

3. **MCP server not available**:
   - Log error
   - Return empty tool list
   - Allow proxy to function in degraded mode

4. **SQL parsing errors**:
   - Default to safe classification (METADATA)
   - Log warning
   - Allow query to proceed

5. **VARIANT inference failures**:
   - Log error
   - Continue without TypeScript interface
   - Don't block query

6. **Confirmation request errors**:
   - Default to denial
   - Log error
   - Block destructive operation

---

## Performance Considerations

### Optimization Strategies

1. **Tool Discovery Caching**:
   - Cache discovered tools
   - Refresh only when plugin reloads
   - Avoid repeated API calls

2. **Variant Sampling**:
   - Use efficient sampling algorithm
   - Limit to max 1000 samples
   - Early termination for small result sets

3. **Logging**:
   - Async logging to avoid blocking
   - Buffer writes for efficiency
   - Rotate logs to manage size

4. **Regex Pattern Compilation**:
   - Compile patterns once on startup
   - Reuse compiled regex objects
   - Avoid repeated compilation

---

## Future Enhancements

### Potential Improvements

1. **CLI Wrapper**:
   - Setup wizard for Snowflake connection
   - Project initialization scaffolding
   - Proxy status monitoring
   - Log viewing commands

2. **Advanced Variant Inference**:
   - Cache inferred interfaces per table
   - Detect schema changes over time
   - Support for Snowflake-specific types (GEOGRAPHY, ARRAY, OBJECT)

3. **Enhanced Metadata**:
   - Column statistics (min/max for numerics)
   - Value distribution histograms
   - Data quality metrics

4. **Query Analysis**:
   - Explain plan analysis
   - Performance metrics
   - Optimization suggestions

5. **Multi-Server Support**:
   - Support multiple Snowflake connections
   - Per-server configuration
   - Connection pooling

---

## Security Considerations

### Threat Model

1. **SQL Injection**:
   - Use parameterized queries (when applicable)
   - Validate all inputs
   - Sanitize log entries

2. **Regex DoS**:
   - Limit pattern complexity
   - Timeout regex matching
   - Reject malicious patterns

3. **Information Leakage**:
   - Never log sensitive data
   - Mask connection strings in logs
   - Sanitize error messages

4. **Privilege Escalation**:
   - Respect Snowflake RBAC
   - Don't override permissions
   - Validate all operations

---

## Success Criteria

The implementation will be considered successful when:

1. ✅ All SELECT queries return metadata only (no row data)
2. ✅ VARIANT columns include inferred TypeScript interfaces
3. ✅ Queries against protected objects are blocked
4. ✅ Destructive operations require confirmation
5. ✅ All interactions are logged in Markdown format
6. ✅ Plugin works with all Snowflake MCP tools
7. ✅ No bypass mechanism exists
8. ✅ Performance is acceptable (<100ms overhead)
9. ✅ Error handling is robust
10. ✅ Documentation is complete

---

## References

### External Documentation

- [OpenCode Plugin System](https://github.com/anomalyco/opencode)
- [OpenCode SDK API](https://github.com/anomalyco/opencode/tree/main/sdk)
- [Snowflake Labs MCP Server](https://github.com/Snowflake-Labs/mcp)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [Snowflake Python Connector](https://docs.snowflake.com/en/user-guide/python-connector/python-connector-connect)

### Internal Documentation

- [OpenCode Event Hooks](./.opencode/context/openagents-repo/plugins/context/capabilities/events.md)
- [OpenCode Tool System](./.opencode/context/openagents-repo/plugins/context/capabilities/tools.md)
- [Plugin Development Guide](./.opencode/context/openagents-repo/plugins/context/capabilities/README.md)

---

**End of Implementation Plan**
