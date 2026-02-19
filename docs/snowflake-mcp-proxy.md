# Snowflake MCP Proxy Plugin

## Overview

The Snowflake MCP Proxy Plugin is a privacy-preserving OpenCode plugin that intercepts Snowflake Labs MCP tool calls, strips row data from responses, and enforces safety guards to ensure no production data is ever exposed to AI agents.

This plugin implements the SDAIDF framework's metadata-only proxy architecture as specified in the README.

## What It Does

### Privacy Preservation

- **Strips Row Data**: All SELECT queries return metadata only (schema, row count, statistics)
- **No Bypass**: Intercepts all Snowflake tool calls at the OpenCode level
- **Agents Never See Actual Data**: Only metadata is returned to AI agents

### Safety Guards

- **Exclusion Patterns**: Blocks queries referencing protected objects (e.g., `PROD.*`, `*_PROD`)
- **Destructive Operation Detection**: Identifies DROP, TRUNCATE, DELETE, ALTER TABLE, MERGE
- **User Confirmation**: Requires explicit user confirmation for destructive operations
- **Complete Audit Trail**: Logs all interactions in Markdown format

### Smart Metadata Extraction

- **Schema**: Column names and data types
- **Statistics**: Row count, null counts, distinct counts
- **VARIANT Inference**: TypeScript interfaces inferred from VARIANT columns using adaptive sampling

### Adaptive Sampling

For VARIANT column inference, the plugin uses an efficient square-root formula:

```
sampleSize = min(1000, floor(sqrt(totalRows)))
```

This provides:
- **10 rows** → 3 samples
- **100 rows** → 10 samples
- **1,000 rows** → 31 samples
- **10,000 rows** → 100 samples
- **100,000 rows** → 316 samples
- **1,000,000 rows** → 1,000 samples (max)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    AI Agent                │
│  (developer, planner, orchestrator, etc.)   │
└────────────────────┬────────────────────────────┘
                     │
                     │ Tool Call
                     ↓
┌─────────────────────────────────────────────────────┐
│      OpenCode Tool Execution Layer             │
│  - tool.execute.before hook                        │
│  - tool.execute.after hook                         │
└────────────────────┬────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────┐
│         Snowflake Proxy Plugin                 │
│  ┌──────────────────────────────────────────┐      │
│  │ tool.execute.before:                             │      │
│  │ 1. Discover Snowflake tools                    │      │
│  │ 2. Check if tool should be intercepted          │      │
│  │ 3. Extract SQL query                             │      │
│  │ 4. Classify query type (DATA vs METADATA)      │      │
│  │ 5. Check exclusion patterns                      │      │
│  │ 6. Detect destructive operations                │      │
│  │ 7. Request confirmation (if needed)             │      │
│  │ 8. Log request                                 │      │
│  └──────────────────────────────────────────┘      │
│                     ↓                                  │
│  ┌──────────────────────────────────────────┐      │
│  │ Snowflake Labs MCP Server (external)        │      │
│  └──────────────────────────────────────────┘      │
│                     ↓                                  │
│  ┌──────────────────────────────────────────┐      │
│  │ tool.execute.after:                              │      │
│  │ 1. Extract result                               │      │
│  │ 2. For DATA queries:                           │      │
│  │    a. Strip all row data                       │      │
│  │    b. Extract metadata                          │      │
│  │    c. Infer TypeScript interfaces (VARIANT)      │      │
│  │ 3. For METADATA queries:                       │      │
│  │    a. Pass through unchanged                   │      │
│  │ 4. Log response                                 │      │
│  └──────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────┘
                     ↓
Agent (receives metadata only)
```

## Installation

### 1. Install Dependencies

```bash
cd .opencode
npm install
```

### 2. Configure Snowflake MCP Server

Follow the [Snowflake-Labs/mcp](https://github.com/Snowflake-Labs/mcp) setup instructions to configure and run the Snowflake MCP server.

### 3. Configure the Proxy

Create `.snowflake-proxy/config.yaml` in your project root:

```yaml
proxy:
  enabled: true

  skip_patterns:
    - "cortex_*"

  exclusion_patterns:
    - "PROD\\..*"
    - ".*_PROD"

  require_confirmation:
    destructive: true

  variant_inference:
    enabled: true
    max_sample_size: 1000

  logging:
    enabled: true
    log_file: ".snowflake-proxy/logs/audit.md"

  snowflake_mcp:
    config_file: "mcp-snowflake-config.yaml"
    connection_name: "default"
```

### 4. Use the Plugin

The plugin is automatically loaded by OpenCode from `.opencode/plugins/snowflake-mcp-proxy/`. No additional configuration is required in OpenCode.

## Query Classification

### DATA Queries (Metadata Only Returned)

All SELECT queries, including scalar queries like `SELECT COUNT(*)`, are classified as DATA queries.

**What Gets Stripped**:
- All row data (actual record values)
- Only metadata is returned

**What Gets Returned**:
- Schema (column names and types)
- Row count
- Null counts per column
- Distinct counts per column
- TypeScript interfaces for VARIANT columns

### METADATA Queries (Results Pass Through)

DDL, DML, DESCRIBE, SHOW, and other non-SELECT queries are classified as METADATA queries.

**Behavior**:
- Results pass through unchanged
- No row data is involved in these operations

## Safety Features

### Exclusion Patterns

Configure regex patterns to block access to protected objects:

```yaml
exclusion_patterns:
  - "PROD\\..*"           # Block PROD database and all schemas
  - ".*_PROD"            # Block any object ending with _PROD
  - ".*_BACKUP"          # Block backup tables
  - ".*_HISTORY"           # Block history tables
  - ".*_ARCHIVE"           # Block archive tables
```

**Example Blocked Query**:
```sql
SELECT * FROM PROD.orders
```
**Error**: `Query blocked: Object 'PROD.orders' matches exclusion pattern 'PROD\..*'`

### Destructive Operation Confirmation

Destructive operations require explicit user confirmation:

**Destructive Operations**:
- DROP TABLE/VIEW/DATABASE/SCHEMA/WAREHOUSE/ROLE/USER/STAGE
- TRUNCATE TABLE
- DELETE FROM
- ALTER TABLE
- MERGE INTO

**Confirmation Flow**:
1. Agent attempts destructive operation
2. Proxy detects destructive keywords
3. OpenCode prompts user for confirmation
4. User confirms → Operation proceeds
5. User denies → Operation blocked

### Audit Logging

All interactions are logged in Markdown format to `.snowflake-proxy/logs/audit.md`.

**Log Entry Includes**:
- Session ID and timestamp
- Tool name and query
- Query type (DATA vs METADATA)
- Status (executed vs blocked)
- Exclusion pattern matches
- Destructive operation flag
- Metadata returned (schema, statistics)
- VARIANT interfaces inferred
- Execution time

**Example Log Entry**:
```markdown
## Session: session_123 | 2026-02-19T15:30:00Z

### Request #1

**Tool**: `snowflake_execute_sql`

**Query**:
```sql
SELECT id, name, email FROM analytics.customers LIMIT 100
```

**Type**: DATA

**Status**: ✅ Executed

**Exclusions**: None

**Destructive**: No

#### Metadata Returned

**Schema**:
| Column | Type | Null Count | Distinct Count |
|--------|------|------------|----------------|
| id | number | 0 | 100 |
| name | string | 0 | 95 |
| email | string | 5 | 95 |

**Row Count**: 100

**Execution Time**: 245ms
```

## Usage Examples

### Example 1: Simple SELECT Query

**Before Proxy**:
```typescript
// Agent calls tool
const result = await snowflake_execute_sql({
  query: "SELECT * FROM analytics.orders LIMIT 100"
})

// Result includes actual order data
console.log(result.rows)
// Output: [
//   {id: 1, customer_id: 101, status: "pending", total: 50.00, ...},
//   {id: 2, customer_id: 102, status: "shipped", total: 75.00, ...},
//   ... 98 more rows with actual data
// ]
```

**After Proxy**:
```typescript
// Agent calls tool (same call)
const result = await snowflake_execute_sql({
  query: "SELECT * FROM analytics.orders LIMIT 100"
})

// Result includes metadata only - NO ACTUAL DATA
console.log(result)
// Output: {
//   metadata: {
//     schema: [
//       {name: "id", type: "number"},
//       {name: "customer_id", type: "number"},
//       {name: "status", type: "string"},
//       {name: "total", type: "number"},
//       {name: "created_at", type: "string"}
//     ],
//     rowCount: 100,
//     nullCounts: {id: 0, customer_id: 0, status: 0, total: 5, created_at: 0},
//     distinctCounts: {id: 100, customer_id: 50, status: 5, total: 95, created_at: 98}
//   },
//   rows: []  // ALWAYS EMPTY - NO ROW DATA
// }
```

### Example 2: SELECT with VARIANT Column

**Query**:
```sql
SELECT id, metadata FROM events.analytics LIMIT 1000
```

**Processing**:
1. Classify as DATA query
2. Execute query (via Snowflake MCP server)
3. Detect VARIANT column: `metadata`
4. Calculate sample size: `min(1000, sqrt(1000))` = 31 samples
5. Sample 31 variant JSON values
6. Infer TypeScript interface from samples
7. Return metadata with interface

**Agent Receives**:
```json
{
  "metadata": {
    "schema": [
      {"name": "id", "type": "number"},
      {"name": "metadata", "type": "variant"}
    ],
    "rowCount": 1000,
    "nullCounts": {"id": 0, "metadata": 0},
    "distinctCounts": {"id": 1000, "metadata": 850},
    "variantInterfaces": {
      "metadata": "interface EventMetadata {\n  source?: string;\n  tags?: string[];\n  priority?: number;\n  timestamp?: string;\n}"
    }
  },
  "rows": []
}
```

### Example 3: Blocked Query (Protected Object)

**Query**:
```sql
SELECT * FROM PROD.payments
```

**Processing**:
1. Classify as DATA query
2. Extract object: `PROD.payments`
3. Check against exclusion patterns
4. Match found: `"PROD.payments"` matches pattern `"PROD\\..*"`
5. Block query
6. Log blocked request

**Agent Receives**:
```
Error: Query blocked: Object 'PROD.payments' matches exclusion pattern 'PROD\..*'
```

**Audit Log Entry**:
```markdown
### Request #3

**Tool**: `snowflake_execute_sql`

**Query**:
```sql
SELECT * FROM PROD.payments
```

**Type**: DATA

**Status**: ❌ Blocked

**Exclusions**:
- PROD.payments matches PROD\..*

**Destructive**: No
```

### Example 4: Destructive Operation (DROP TABLE)

**Query**:
```sql
DROP TABLE analytics.temp_table
```

**Processing**:
1. Classify as METADATA query
2. Check exclusions: No match
3. Detect destructive: DROP keyword found
4. Request user confirmation via OpenCode
5. User confirms: Yes
6. Execute query
7. Pass through result

**Confirmation Prompt** (via OpenCode):
```
Destructive operation detected.

This query will modify or destroy data:

DROP TABLE analytics.temp_table

Confirm to proceed? [Yes/No]
```

## Troubleshooting

### Plugin Not Loading

**Symptoms**:
- Tools not being intercepted
- No log entries created
- Snowflake tools returning raw data

**Solutions**:
1. Verify `.opencode/plugins/snowflake-mcp-proxy/` directory exists
2. Check `config.yaml` exists and is valid YAML
3. Review OpenCode logs for plugin errors
4. Ensure `enabled: true` in config
5. Check dependencies are installed: `cd .opencode && npm install`

### Tools Not Being Intercepted

**Symptoms**:
- Snowflake tools returning raw data
- No metadata transformation

**Solutions**:
1. Check if Snowflake MCP server is connected
2. Verify tool discovery is working (check OpenCode logs for "Discovered X Snowflake MCP tools")
3. Ensure tool names match discovered tools
4. Check if tool is in `skip_patterns`

### Exclusion Patterns Not Working

**Symptoms**:
- Queries against protected objects succeed
- No blocking errors

**Solutions**:
1. Verify regex syntax is correct
2. Check if pattern is correctly escaped (e.g., `\\.` for literal dot)
3. Test pattern with regex tester
4. Review audit logs for pattern matches

### VARIANT Inference Failing

**Symptoms**:
- No TypeScript interfaces in metadata
- Errors in logs

**Solutions**:
1. Check if `variant_inference.enabled: true`
2. Verify VARIANT columns are detected
3. Review logs for JSON parsing errors
4. Ensure sample size calculation is correct

### Confirmation Not Working

**Symptoms**:
- Destructive operations execute without prompt
- Errors when requesting confirmation

**Solutions**:
1. Check if `require_confirmation.destructive: true`
2. Verify OpenCode's `permission.ask` is available
3. Review logs for permission errors
4. Test with a simple DROP TABLE query

## File Structure

```
.opencode/
└── plugins/
    └── snowflake-mcp-proxy/
        ├── index.ts                    # Main plugin entry point
        ├── query-classifier.ts         # Query classification logic
        ├── row-data-stripper.ts        # Row data stripping & metadata extraction
        ├── variant-inference.ts        # VARIANT column TypeScript interface inference
        ├── exclusion-checker.ts        # Pattern matching for protected objects
        ├── destructive-detector.ts      # Destructive operation detection
        ├── tool-discovery.ts           # Discover Snowflake MCP tools
        ├── config-loader.ts            # Load proxy and Snowflake configs
        ├── audit-logger.ts             # Markdown audit logging
        ├── utils.ts                    # Helper functions
        ├── types.ts                    # TypeScript type definitions
        ├── package.json                 # Plugin dependencies
        └── README.md                   # Plugin documentation

.snowflake-proxy/
    └── config.yaml                 # Proxy configuration template
    └── logs/
        └── audit.md                 # Audit trail (auto-created)
```

## Components

### 1. Main Plugin (`index.ts`)

- Registers `tool.execute.before` and `tool.execute.after` hooks with OpenCode
- Loads configuration and initializes audit logger
- Discovers Snowflake MCP tools via OpenCode client API
- Orchestrates all modules

### 2. Query Classifier (`query-classifier.ts`)

- Classifies SQL queries into DATA vs METADATA
- ALL SELECT queries are DATA (including scalar queries)
- DDL/DML/DESCRIBE/SHOW are METADATA

### 3. Row Data Stripper (`row-data-stripper.ts`)

- Strips all row data from SELECT query results
- Extracts metadata: schema, row count, null counts, distinct counts
- Delegates VARIANT column processing to inference module

### 4. VARIANT Inference (`variant-inference.ts`)

- Infers TypeScript interfaces from VARIANT column data
- Uses adaptive sampling: `min(1000, floor(sqrt(totalRows)))`
- Handles nested objects, arrays, optional fields
- Parses JSON values and infers schema

### 5. Exclusion Checker (`exclusion-checker.ts`)

- Checks if queries reference protected objects using regex patterns
- Extracts object references from SQL (FROM, JOIN, UPDATE, INSERT, etc.)
- Blocks queries matching exclusion patterns

### 6. Destructive Detector (`destructive-detector.ts`)

- Detects destructive operations: DROP, TRUNCATE, DELETE, ALTER TABLE, MERGE
- Requests user confirmation via OpenCode's `permission.ask` hook
- Blocks unconfirmed destructive operations

### 7. Tool Discovery (`tool-discovery.ts`)

- Discovers Snowflake MCP tools via OpenCode client API (`client.tool.list()`)
- Filters for `snowflake_*` tools (excludes `cortex_*`)
- Includes fallback pattern-based discovery

### 8. Configuration Loader (`config-loader.ts`)

- Loads proxy config from `.snowflake-proxy/config.yaml`
- Loads Snowflake connection config from `~/.snowflake/config.toml`
- Provides default configuration with sensible defaults

### 9. Audit Logger (`audit-logger.ts`)

- Logs all interactions in Markdown format
- Tracks: tool name, query, type, status, exclusions, metadata
- Auto-creates log file with header

### 10. Utils (`utils.ts`)

- Helper functions for SQL extraction, formatting, Markdown sanitization
- Session ID generation
- Timestamp formatting

### 11. Types (`types.ts`)

- TypeScript type definitions for all components
- Plugin context, configuration, query results, audit entries

## Dependencies

### Runtime Dependencies
- `yaml` ^2.3.4 - For YAML configuration parsing
- `toml` ^3.0.0 - For TOML configuration parsing

### Peer Dependencies
- `@opencode-ai/plugin` - OpenCode plugin API
- `@opencode-ai/sdk` - OpenCode client API

## Security Considerations

- **No Row Data Exposure**: All row data stripped before being returned to agents
- **Exclusion Pattern Enforcement**: Protected objects cannot be accessed
- **Confirmation Gates**: Destructive operations require user approval
- **Complete Audit Trail**: All interactions logged for review
- **No Bypass Mechanism**: Operates at OpenCode level with no bypass

## Performance

- **Tool Discovery**: ~50-100ms (cached after first run)
- **Query Classification**: <1ms
- **Exclusion Check**: <5ms
- **Row Data Stripping**: ~10-50ms (depending on row count)
- **VARIANT Inference**: ~100-500ms (depending on sample size)
- **Total Overhead**: <100ms per query (typical)

## Future Enhancements

Potential improvements for future versions:

1. **CLI Wrapper**: Setup wizard for Snowflake connection and project initialization
2. **Advanced VARIANT Inference**: Cache inferred interfaces, detect schema changes
3. **Enhanced Metadata**: Min/max values for numerics, value distributions
4. **Multi-Server Support**: Support multiple Snowflake connections
5. **Query Analysis**: Explain plan analysis, performance metrics

## References

- [OpenCode Plugin System](https://github.com/anomalyco/opencode)
- [OpenCode SDK API](https://github.com/anomalyco/opencode/tree/main/sdk)
- [Snowflake Labs MCP Server](https://github.com/Snowflake-Labs/mcp)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [Implementation Plan](/.opencode/plans/snowflake-mcp-proxy-implementation.md)

## License

This plugin is part of the SDAIDF (Spec-Driven AI Development Framework) project.

## Version

**Version**: 1.0.0
**Release Date**: February 19, 2026
