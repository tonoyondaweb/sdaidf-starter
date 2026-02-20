# Snow CLI MCP Server - Technical Architecture & Implementation Plan

**Project:** SDAIDF Snowflake CLI MCP Server  
**Version:** 3.0  
**Date:** February 20, 2026  
**Author:** Technical Design

---

## 1. Executive Summary

This document outlines the technical architecture for building an MCP (Model Context Protocol) server that wraps Snowflake's official CLI (`snow`). The MCP server provides AI agents with structured tools for Snowflake operations while enforcing a **metadata-only proxy pattern** that prevents enterprise data leakage.

### Key Design Principles

1. **Zero Data Leakage**: All query responses are filtered through a metadata proxy that strips row data
2. **Query Classification**: Automatically classify queries as metadata-only or scalar-allowed
3. **Environment Isolation**: Regex-based exclusion patterns prevent production data access
4. **Clear Separation**: Discovery/Lineage (informational) vs Sync (orchestration)

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MCP Host (Claude/Agent)                          │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Snow CLI MCP Server                               │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                      TOOL LAYER                                  │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │  │
│  │  │   Query      │ │ Discovery &   │ │    Sync      │          │  │
│  │  │   Tools      │ │   Lineage     │ │    Tools     │          │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │              METADATA PROXY LAYER (Guardrail)                    │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │  │
│  │  │  Query       │ │   Result     │ │  Exclusion   │          │  │
│  │  │  Classifier  │ │   Redactor   │ │   Checker    │          │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │               COMMAND EXECUTOR LAYER                            │  │
│  │              (child_process spawn wrapper)                      │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Snow CLI (snow)                                 │
│                   [Uses Connection from Config]                         │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Snowflake Database                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Clarification: Discovery vs Lineage vs Object Sync

| Concept | Purpose | Tools Used |
|---------|---------|------------|
| **Discovery** | Query metadata about objects (what exists) | `list_objects`, `describe_object`, `get_ddl` |
| **Lineage** | Understand object dependencies (what depends on what) | `get_lineage`, `get_dependencies` |
| **Object Sync** | Create local file structure using discovery | `sync_objects` (uses discovery internally) |

### 2.3 Technology Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Language | TypeScript | 5.x |
| MCP SDK | @modelcontextprotocol/sdk | 1.26.x |
| CLI Wrapper | child_process (Node.js built-in) | - |
| Input Validation | Zod | 3.x |
| Configuration | dotenv / YAML | - |
| Build Tool | tsx / tsc | - |

---

## 3. Metadata Proxy (Guardrail) - Core Security Component

### 3.1 How It Works

The Metadata Proxy is a **middleware layer** that intercepts all query responses:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Query Tool    │────▶│  Execute Query   │────▶│  Metadata Proxy │
│   (Input)       │     │  via Snow CLI    │     │  Middleware     │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                             │
                         ┌──────────────────┐                │
                         │  Agent Response  │◀───────────────┘
                         │  (Safe Output)  │
                         └──────────────────┘
```

### 3.2 Query Classification

Every query is classified to determine how to process the response:

| Query Type | Classification | Response |
|------------|---------------|----------|
| `SELECT * FROM table` | **DATA** | Redact rows, keep schema |
| `SELECT COUNT(*) FROM table` | **SCALAR** | Return value |
| `SELECT * FROM INFORMATION_SCHEMA...` | **METADATA** | Return as-is |
| `GET_DDL('TABLE', ...)` | **METADATA** | Return DDL text |
| `DESCRIBE TABLE t` | **METADATA** | Return column info |

#### Scalar Query Patterns (Allowed to return actual values)

```typescript
const SCALAR_PATTERNS = [
  // COUNT, SUM, AVG, MIN, MAX
  /^\s*SELECT\s+(COUNT|SUM|AVG|MIN|MAX|COUNT_DISTINCT)\s*\(/i,
  
  // Queries starting with these functions
  /^\s*SELECT\s+(CURRENT_|SESSION_|SYSTEM\$)/i,
  
  // Information schema queries
  /^\s*SELECT\s+.*\s+FROM\s+(INFORMATION_SCHEMA|DATA_)/i,
  
  // GET_DDL, DESCRIBE
  /GET_DDL\s*\(/i,
  /^DESC(RIPE)?\s+/i,
];
```

### 3.3 What's Returned vs What's Redacted

| Data Category | Returned to Agent? | Example |
|---------------|-------------------|---------|
| **Schema/Column Names** | ✅ Yes | `[{name: "id", type: "NUMBER"}]` |
| **Data Types** | ✅ Yes | `"type": "VARCHAR(100)"` |
| **Statistics** | ✅ Yes | `{row0, nullPct: {idCount: 100: 0}}` |
| **VARIANT Structure** | ✅ Yes (as TypeScript interface) | `interface Payload { ... }` |
| **Actual Row Data** | ❌ No | `[{"id": 1, "name": "John"}]` |
| **Sample Values** | ❌ No | Any actual data values |

### 3.4 Exclusion Pattern Checker

Before any query is executed, the system checks against exclusion patterns defined in `project.yaml`:

```typescript
interface ExclusionConfig {
  patterns: RegExp[];
  objectTypes: string[];
}

const DEFAULT_EXCLUSIONS = [
  /^PROD_/i,           // Production databases
  /_PROD$/i,           // Tables ending with _PROD
  /_BACKUP$/i,          // Backup tables
  /_ARCHIVE$/i,         // Archive tables
  /^SYSTEM_/i,          // System objects
];

function checkExclusions(objectName: string, config: ExclusionConfig): boolean {
  for (const pattern of config.patterns) {
    if (pattern.test(objectName)) {
      return true; // Excluded!
    }
  }
  return false;
}
```

### 3.5 VARIANT Type Inference

For VARIANT columns, the proxy generates TypeScript interfaces:

```typescript
interface TypeScriptInterface {
  name: string;
  properties: {
    path: string;
    type: string;
    nullable: boolean;
  }[];
}

// Example output for a VARIANT column containing JSON:
interface OrderPayload {
  order_id: string;
  customer_name: string;
  items: Array<{ product_id: string; quantity: number }>;
  total_amount: number;
}
```

---

## 4. Tool Definitions

### 4.1 Tool Categories

| Category | Tools | Data Handling | Purpose |
|----------|-------|---------------|---------|
| **Query Tools** | `execute_sql`, `execute_scalar` | Guardrailed + Unfiltered | Run SQL queries |
| **Discovery Tools** | `list_objects`, `describe_object`, `get_ddl` | Metadata only | Query what objects exist |
| **Lineage Tools** | `get_lineage`, `get_dependencies` | Metadata only | Understand object relationships |
| **Sync Tools** | `sync_objects`, `check_staleness` | File-based | Build local repository |
| **DDL Tools** | `execute_ddl` | No return data | Create/alter/drop objects |

### 4.2 Query Tools

#### Tool: `execute_sql` (Guardrailed - Metadata Only)

```typescript
server.tool(
  "execute_sql",
  {
    query: z.string().describe("SQL query to execute"),
    connection: z.string().optional().describe("Connection name from snow CLI config"),
  },
  async ({ query, connection }) => {
    // 1. Check exclusion patterns
    const objectMatch = extractObjectNames(query);
    for (const obj of objectMatch) {
      if (checkExclusions(obj, config.exclusions)) {
        return createErrorResponse("EXCLUDED_OBJECT", 
          `Query references excluded object: ${obj}`);
      }
    }
    
    // 2. Classify query
    const queryType = classifyQuery(query);
    
    // 3. Execute via snow CLI
    const result = await executeSnowCLI(['sql', '-q', query], { connection });
    
    // 4. Apply metadata proxy based on classification
    if (queryType === 'metadata') {
      return redactResult(result);
    } else {
      // Scalar queries return actual values
      return { 
        content: [{ type: "text", text: JSON.stringify(result) }],
        _queryType: "scalar"
      };
    }
  }
);
```

#### Tool: `execute_scalar` (Unfiltered - For Auditing)

```typescript
server.tool(
  "execute_scalar",
  {
    query: z.string().describe("Scalar/aggregation query (COUNT, SUM, etc.)"),
    connection: z.string().optional(),
    limit: z.number().default(100).describe("Max rows to return"),
  },
  async ({ query, connection, limit }) => {
    const safeQuery = addLimitIfNeeded(query, limit);
    const result = await executeSnowCLI(['sql', '-q', safeQuery], { connection });
    
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      _queryType: "scalar",
      _rowCount: result.rowCount
    };
  }
);
```

### 4.3 Discovery Tools

#### Tool: `list_objects`

Lists objects of a given type. All results are metadata-only.

```typescript
server.tool(
  "list_objects",
  {
    objectType: z.enum(OBJECT_TYPES),
    database: z.string().optional(),
    schema: z.string().optional(),
    like: z.string().optional(),
    connection: z.string().optional(),
  },
  async ({ objectType, database, schema, like, connection }) => {
    const args = ['object', 'list', objectType];
    if (database || schema) args.push('--in', `database=${database || '*'}.schema=${schema || '*'}`);
    if (like) args.push('--like', like);
    
    const result = await executeSnowCLI(args, { connection });
    const filtered = filterExcluded(result, config.exclusions);
    
    return { content: [{ type: "text", text: JSON.stringify({ objects: filtered }) }] };
  }
);
```

#### Tool: `describe_object`

Gets detailed metadata about an object.

```typescript
server.tool(
  "describe_object",
  {
    objectType: z.enum(OBJECT_TYPES),
    objectName: z.string(),
    database: z.string().optional(),
    schema: z.string().optional(),
    connection: z.string().optional(),
  },
  async ({ objectType, objectName, database, schema, connection }) => {
    if (checkExclusions(objectName, config.exclusions)) {
      return createErrorResponse("EXCLUDED_OBJECT", "Object matches exclusion pattern");
    }
    
    const args = ['object', 'describe', objectType, objectName];
    if (database || schema) args.push('--in', `database=${database || ''}.schema=${schema || ''}`);
    
    const result = await executeSnowCLI(args, { connection });
    
    return { content: [{ type: "text", text: JSON.stringify({ metadata: extractMetadata(result) }) }] };
  }
);
```

#### Tool: `get_ddl`

Retrieves DDL for recreating an object.

```typescript
server.tool(
  "get_ddl",
  {
    objectType: z.string(),
    objectName: z.string(),
    database: z.string().optional(),
    schema: z.string().optional(),
    connection: z.string().optional(),
  },
  async ({ objectType, objectName, database, schema, connection }) => {
    if (checkExclusions(objectName, config.exclusions)) {
      return createErrorResponse("EXCLUDED_OBJECT", "Object matches exclusion pattern");
    }
    
    const ddlQuery = `SELECT GET_DDL('${objectType}', '${database || ''}.${schema || ''}.${objectName}') as DDL`;
    const result = await executeSnowCLI(['sql', '-q', ddlQuery], { connection });
    
    return { content: [{ type: "text", text: result.rows[0]?.DDL || '' }] };
  }
);
```

### 4.4 Lineage Tools

#### Tool: `get_lineage`

Gets upstream/downstream dependencies for an object.

```typescript
server.tool(
  "get_lineage",
  {
    objectName: z.string(),
    objectType: z.enum(["table", "view"]),
    database: z.string().optional(),
    schema: z.string().optional(),
    direction: z.enum(["upstream", "downstream", "both"]).default("both"),
    connection: z.string().optional(),
  },
  async ({ objectName, objectType, direction, connection }) => {
    // Uses Snowflake's OBJECT_DEPENDENCIES table function
    const lineageQuery = `
      SELECT * FROM TABLE(
        SNOWFLAKE.CORE.OBJECT_DEPENDENCIES(
          OBJECT_NAME => '${objectName}',
          OBJECT_TYPE => '${objectType.toUpperCase()}',
          DIRECTION => '${direction.toUpperCase()}'
        ))
    `;
    
    const result = await executeSnowCLI(['sql', '-q', lineageQuery], { connection });
    
    return { content: [{ type: "text", text: JSON.stringify({ lineage: result.rows }) }] };
  }
);
```

#### Tool: `get_dependencies`

Gets direct dependencies for views/procedures.

```typescript
server.tool(
  "get_dependencies",
  {
    objectName: z.string(),
    objectType: z.enum(["view", "materialized_view", "function", "procedure"]),
    database: z.string().optional(),
    schema: z.string().optional(),
    connection: z.string().optional(),
  },
  async ({ objectName, database, schema, connection }) => {
    const depsQuery = `
      SELECT REFERENCE_OBJECT_NAME, REFERENCE_OBJECT_TYPE
      FROM ${database || 'INFORMATION_SCHEMA'}.OBJECT_REFERENCES
      WHERE OBJECT_NAME = '${objectName}'
    `;
    
    const result = await executeSnowCLI(['sql', '-q', depsQuery], { connection });
    
    return { content: [{ type: "text", text: JSON.stringify({ dependencies: result.rows }) }] };
  }
);
```

### 4.5 Sync Tools (Object Repository Builder)

#### Tool: `sync_objects`

Orchestrates discovery tools to build local object repository:

```typescript
server.tool(
  "sync_objects",
  {
    connection: z.string().optional(),
    targetDir: z.string().describe("Target directory for sync output"),
    includeDatabases: z.boolean().default(true),
    includeSchemas: z.boolean().default(true),
    includeTables: z.boolean().default(true),
    includeViews: z.boolean().default(true),
    includeFunctions: z.boolean().default(false),
    includeProcedures: z.boolean().default(false),
    includeStages: z.boolean().default(false),
    includeTasks: z.boolean().default(false),
  },
  async ({ connection, targetDir, ...options }) => {
    const syncResults: SyncResult[] = [];
    
    // Uses list_objects + get_ddl internally
    if (options.includeDatabases) {
      const databases = await listObjects('database', connection);
      for (const db of databases) {
        if (checkExclusions(db.name, config.exclusions)) continue;
        
        const ddl = await getDDL('database', db.name, connection);
        await writeFile(`${targetDir}/src/${db.name}/_database.sql`, ddl);
        syncResults.push({ type: 'database', name: db.name, status: 'synced' });
      }
    }
    
    // Repeat for schemas, tables, views, etc.
    // ...
    
    return { content: [{ type: "text", text: JSON.stringify({ synced: syncResults.length, results: syncResults }) }] };
  }
);
```

#### Output File Structure

```
project-root/
├── src/
│   └── {DB}/
│       ├── _database.sql
│       └── {SCHEMA}/
│           ├── _schema.sql
│           ├── tables/{TABLE}.sql
│           ├── views/{VIEW}.sql
│           └── functions/{FUNC}.sql
└── .object-repository.json  # Index of all synced objects
```

#### Tool: `check_staleness`

Compares local DDL with remote to detect changes.

```typescript
server.tool(
  "check_staleness",
  {
    objectName: z.string(),
    objectType: z.string(),
    localPath: z.string(),
    connection: z.string().optional(),
  },
  async ({ objectName, objectType, localPath, connection }) => {
    const currentDDL = await getDDL(objectType, objectName, connection);
    const localDDL = await readFile(localPath);
    
    const isStale = hash(currentDDL) !== hash(localDDL);
    
    return { content: [{ type: "text", text: JSON.stringify({ isStale, objectName }) }] };
  }
);
```

### 4.6 DDL Tools

#### Tool: `execute_ddl`

Executes CREATE/ALTER/DROP statements. No row data returned.

```typescript
server.tool(
  "execute_ddl",
  {
    ddl: z.string().describe("CREATE/ALTER/DROP statement"),
    connection: z.string().optional(),
  },
  async ({ ddl, connection }) => {
    const objectMatch = extractObjectNames(ddl);
    for (const obj of objectMatch) {
      if (checkExclusions(obj, config.exclusions)) {
        return createErrorResponse("EXCLUDED_OBJECT", `DDL references excluded object: ${obj}`);
      }
    }
    
    await executeSnowCLI(['sql', '-q', ddl], { connection });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
  }
);
```

### 4.7 Supported Object Types

Complete list of Snowflake object types (Cortex explicitly excluded):

```typescript
const OBJECT_TYPES = [
  // Core database objects
  "database", "schema",
  
  // Data objects
  "table", "view", "materialized_view",
  
  // Code objects
  "function", "procedure",
  
  // Storage objects
  "stage", "file_format",
  
  // Workflow objects
  "task", "stream",
  
  // Compute objects
  "warehouse", "compute_pool",
  
  // Security objects
  "role", "user", "network_rule", "integration", "secret", "tag",
] as const;
```

---

## 5. Configuration

### 5.1 Project Local Config (`project.yaml`)

```yaml
# SDAIDF Project Configuration
project:
  name: my-snowflake-project
  version: "1.0"

# Exclusion patterns - objects matching these are NEVER queried
exclusions:
  patterns:
    - "^PROD_"
    - "_PROD$"
    - "_BACKUP$"
    - "_ARCHIVE$"
    - "^SYSTEM_"
  objectTypes:
    - "SNAPSHOT"

# Snow CLI Connection (from ~/.snowflake/config.toml)
snowcli:
  connection: "dev"
  defaults:
    warehouse: "COMPUTE_WH"
    role: "SYSADMIN"

# Metadata Proxy Settings
guardrail:
  maxScalarRows: 1000
  variantAnalysis:
    sampleSize: 100

# Sync Settings
sync:
  targetDir: "./src"
```

### 5.2 Environment Variables

```bash
SDAIDF_CONFIG_PATH="./project.yaml"
SDAIDF_ENV="development"
SNOW_CONNECTION="dev"
LOG_LEVEL="info"
```

---

## 6. Error Handling

### 6.1 Error Categories

| Error Code | Description | Agent Action |
|------------|-------------|---------------|
| `EXCLUDED_OBJECT` | Object matches exclusion pattern | Stop - cannot proceed |
| `QUERY_CLASSIFIED` | Query was reclassified as metadata | Read redacted response |
| `AUTH_FAILED` | Snowflake authentication failed | Check credentials |
| `OBJECT_NOT_FOUND` | Requested object doesn't exist | Verify object name |
| `PERMISSION_DENIED` | Insufficient privileges | Request role change |
| `CLI_NOT_FOUND` | Snow CLI not installed | Install snow CLI |

### 6.2 Error Response Format

```typescript
{
  content: [{
    type: "text",
    text: JSON.stringify({
      error: "EXCLUDED_OBJECT",
      message: "Table 'PROD_ORDERS' matches exclusion pattern '^PROD_'",
      code: "E1001"
    })
  }],
  isError: true
}
```

---

## 7. Test Plan

### 7.1 Test Categories

| Category | Coverage Target |
|----------|----------------|
| Query Classifier | 100% |
| Exclusion Checker | 100% |
| Result Redactor | 90%+ |
| CLI Executor | 90%+ |
| MCP Tools | 90%+ |
| Integration | 80%+ |
| Security (Data Leakage Prevention) | 100% |

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Project initialization with TypeScript
- [ ] CLI executor wrapper
- [ ] Basic MCP server setup
- [ ] STDIO transport

### Phase 2: Metadata Proxy (Week 2)
- [ ] Query classifier
- [ ] Exclusion pattern checker
- [ ] Result redactor
- [ ] TypeScript interface generator for VARIANT

### Phase 3: Query & Discovery Tools (Week 3)
- [ ] `execute_sql` with proxy
- [ ] `execute_scalar` unfiltered
- [ ] `list_objects`
- [ ] `describe_object`
- [ ] `get_ddl`

### Phase 4: Lineage & Sync (Week 4)
- [ ] `get_lineage`
- [ ] `get_dependencies`
- [ ] `sync_objects` (uses discovery internally)
- [ ] `check_staleness`

### Phase 5: Configuration & Testing (Week 5)
- [ ] project.yaml parser
- [ ] Connection from snow CLI config
- [ ] Comprehensive test suite

---

## 9. Summary

This architecture provides:

1. **Zero Data Leakage**: Metadata Proxy strips all row data from SELECT queries
2. **Query Classification**: Automatic detection of metadata vs scalar queries
3. **Environment Isolation**: Regex-based exclusion patterns prevent production access
4. **No Duplication**: Discovery/Lineage (info) → Sync (orchestration using discovery)
5. **Type Safety**: TypeScript interfaces for VARIANT columns
6. **Complete Coverage**: All Snowflake object types supported (Cortex explicitly excluded)

The MCP server is designed specifically for AI agent tools, with security as the primary concern.

---

*Document Version: 3.0*  
*Last Updated: February 20, 2026*
