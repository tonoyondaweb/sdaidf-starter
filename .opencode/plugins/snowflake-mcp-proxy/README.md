# Snowflake MCP Proxy Plugin

A privacy-preserving proxy plugin for OpenCode that intercepts Snowflake Labs MCP tool calls, strips row data from responses, and enforces safety guards to ensure no production data is ever exposed to AI agents.

## Overview

This plugin provides:

- **Privacy Preservation**: Ensures no actual row data is ever returned to agents
- **Safety Guards**: Blocks access to protected objects and requires confirmation for destructive operations
- **Metadata Only**: Returns only schema and metadata (including TypeScript interfaces for VARIANT columns)
- **Complete Audit**: Logs all interactions in Markdown format
- **No Bypass**: Intercepts all Snowflake tool calls at OpenCode level

## How It Works

### Architecture

```
AI Agent → Snowflake MCP Tool Call
           ↓
    OpenCode Tool Execution Layer (tool.execute.before/after hooks)
           ↓
    Snowflake Proxy Plugin
        ├── Discover Snowflake tools via OpenCode client API
        ├── Classify queries (DATA vs METADATA)
        ├── Check exclusion patterns
        ├── Detect destructive operations
        ├── Request confirmation (if needed)
        ├── Strip row data from responses
        ├── Extract metadata (schema, statistics)
        ├── Infer TypeScript interfaces for VARIANT columns
        └── Log all interactions
           ↓
Agent (receives metadata only)
```

### Query Classification

- **DATA queries**: ALL SELECT statements (including `SELECT COUNT(*)`, scalar queries)
  - Row data is stripped
  - Only metadata is returned (schema, row count, null counts, distinct counts)
  - VARIANT columns include inferred TypeScript interfaces

- **METADATA queries**: DDL, DML, DESCRIBE, SHOW, etc.
  - Results pass through unchanged
  - No row data is involved

## Installation

### 1. Install Dependencies

The plugin requires the following npm packages:

```bash
cd .opencode
npm install
```

This will install:
- `yaml` - For YAML configuration parsing
- `toml` - For TOML configuration parsing

### 2. Configure Snowflake MCP Server

Ensure the Snowflake Labs MCP server is configured and running. See [Snowflake-Labs/mcp](https://github.com/Snowflake-Labs/mcp) for setup instructions.

Example configuration in `.snowflake-proxy/mcp-snowflake-config.yaml`:

```yaml
other_services:
  object_manager: true
  query_manager: true
  semantic_manager: false

sql_statement_permissions:
  - Select: true
  - Create: true
  - Drop: true
  - Alter: true
  - Update: true
  - Delete: true
  - Insert: true
  - Merge: true
  - TruncateTable: true
  - Unknown: false
```

### 3. Configure Proxy

Create `.snowflake-proxy/config.yaml` in your project root:

```yaml
proxy:
  enabled: true

  skip_patterns:
    - "cortex_*"

  exclusion_patterns:
    - "PROD\\..*"
    - ".*_PROD"
    - ".*_BACKUP"

  require_confirmation:
    destructive: true

  variant_inference:
    enabled: true
    max_sample_size: 1000
    sampling_formula: "sqrt"

  logging:
    enabled: true
    log_file: ".snowflake-proxy/logs/audit.md"
    log_level: "info"

  snowflake_mcp:
    config_file: "mcp-snowflake-config.yaml"
    connection_name: "default"
```

### 4. Enable Plugin

The plugin is automatically loaded by OpenCode from `.opencode/plugins/snowflake-mcp-proxy/`.

## Configuration

### Exclusion Patterns

Block access to protected objects using regex patterns:

```yaml
exclusion_patterns:
  - "PROD\\..*"           # Block PROD database and all schemas
  - ".*_PROD"            # Block any object ending with _PROD
  - ".*_BACKUP"          # Block backup tables
  - ".*_HISTORY"           # Block history tables
```

### Destructive Operation Confirmation

Require user confirmation before executing destructive operations:

```yaml
require_confirmation:
  destructive: true  # DROP, TRUNCATE, DELETE, ALTER TABLE, MERGE
```

When a destructive operation is detected, OpenCode will prompt for confirmation.

### VARIANT Inference

Configure TypeScript interface inference for VARIANT columns:

```yaml
variant_inference:
  enabled: true
  max_sample_size: 1000    # Maximum samples for inference
  sampling_formula: "sqrt"    # Use square root formula
```

**Sampling Formula**: `sampleSize = min(1000, floor(sqrt(totalRows)))`

This ensures efficient sampling:
- 10 rows → 3 samples
- 100 rows → 10 samples
- 1,000 rows → 31 samples
- 10,000 rows → 100 samples
- 100,000 rows → 316 samples
- 1,000,000 rows → 1,000 samples (max)

### Logging

Configure audit logging:

```yaml
logging:
  enabled: true
  log_file: ".snowflake-proxy/logs/audit.md"
  log_level: "info"  # debug, info, warn, error
```

All interactions are logged in Markdown format:

```markdown
## Session: session_xyz | 2026-02-19T15:30:00Z

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

### Example 1: SELECT Query with Row Data Stripping

**Agent Request**:
```
snowflake_execute_sql(query="SELECT * FROM analytics.orders LIMIT 100")
```

**Proxy Processing**:
1. Classify as DATA query
2. Check exclusions: No match
3. Execute query (via Snowflake MCP server)
4. Strip all row data
5. Extract metadata:
   - Schema: 5 columns
   - Row count: 100
   - Null counts: email=10
   - Distinct counts: status=5
6. Return metadata only

**Agent Receives**:
```json
{
  "metadata": {
    "schema": [
      {"name": "id", "type": "number"},
      {"name": "customer_id", "type": "number"},
      {"name": "status", "type": "string"},
      {"name": "total", "type": "number"},
      {"name": "created_at", "type": "string"}
    ],
    "rowCount": 100,
    "nullCounts": {"id": 0, "customer_id": 0, "status": 0, "total": 5, "created_at": 0},
    "distinctCounts": {"id": 100, "customer_id": 50, "status": 5, "total": 95, "created_at": 98}
  },
  "rows": []
}
```

### Example 2: SELECT with VARIANT Column

**Agent Request**:
```
snowflake_execute_sql(query="SELECT id, metadata FROM events.analytics LIMIT 1000")
```

**Proxy Processing**:
1. Classify as DATA query
2. Execute query
3. Detect VARIANT column: `metadata`
4. Calculate sample size: min(1000, sqrt(1000)) = 31
5. Sample 31 variant values
6. Infer TypeScript interface

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

### Example 3: Blocked Query (Exclusion Pattern)

**Agent Request**:
```
snowflake_execute_sql(query="SELECT * FROM PROD.payments")
```

**Proxy Processing**:
1. Classify as DATA query
2. Check exclusions: `"PROD.payments"` matches pattern `"PROD\\..*"`
3. Block query
4. Return error

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

**Agent Request**:
```
snowflake_drop_table(name="analytics.temp_table")
```

**Proxy Processing**:
1. Classify as METADATA query
2. Check exclusions: No match
3. Check destructive: DROP detected
4. Request confirmation via OpenCode
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

## Safety Features

### No Bypass Mechanism

The proxy intercepts all Snowflake MCP tool calls at the OpenCode level (`tool.execute.before` and `tool.execute.after` hooks). There is no way for agents to bypass the proxy and access raw row data.

### Exclusion Pattern Enforcement

Queries referencing protected objects are blocked before execution:

```yaml
exclusion_patterns:
  - "PROD\\..*"
  - ".*_PROD"
  - ".*_BACKUP"
```

### Destructive Operation Protection

Destructive operations require explicit user confirmation:

- DROP
- TRUNCATE
- DELETE
- ALTER TABLE
- MERGE

### Complete Audit Trail

Every interaction is logged in Markdown format with:

- Tool name and query
- Query type (DATA vs METADATA)
- Status (executed vs blocked)
- Exclusion pattern matches
- Destructive operation detection
- Metadata returned (schema, statistics, VARIANT interfaces)
- Execution time

## Troubleshooting

### Plugin Not Loading

**Symptom**: Tools not being intercepted, no log entries created.

**Solutions**:
1. Verify `.opencode/plugins/snowflake-mcp-proxy/` directory exists
2. Check `config.yaml` exists and is valid YAML
3. Review OpenCode logs for plugin errors
4. Ensure `enabled: true` in config

### Tools Not Being Intercepted

**Symptom**: Snowflake tools returning raw data, no metadata transformation.

**Solutions**:
1. Check if Snowflake MCP server is connected
2. Verify tool discovery is working (check OpenCode logs)
3. Ensure tool names match discovered tools
4. Check if tool is in `skip_patterns`

### Exclusion Patterns Not Working

**Symptom**: Queries against protected objects succeed, no blocking errors.

**Solutions**:
1. Verify regex syntax is correct
2. Check if pattern is correctly escaped (e.g., `\\.` for literal dot)
3. Test pattern with regex tester
4. Review audit logs for pattern matches

### VARIANT Inference Failing

**Symptom**: No TypeScript interfaces in metadata, errors in logs.

**Solutions**:
1. Check if `variant_inference.enabled: true`
2. Verify VARIANT columns are detected
3. Review logs for JSON parsing errors
4. Ensure sample size calculation is correct

### Confirmation Not Working

**Symptom**: Destructive operations execute without prompt.

**Solutions**:
1. Check if `require_confirmation.destructive: true`
2. Verify OpenCode's `permission.ask` is available
3. Review logs for permission errors
4. Test with a simple DROP TABLE query

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
│       ├── package.json                 # Plugin dependencies
│       └── README.md                   # This file
.snowflake-proxy/                      # Project-specific config
├── config.yaml                         # Proxy configuration
└── logs/
    └── audit.md                        # Audit trail (auto-created)
```

## Development

### Running in Development

The plugin is automatically loaded by OpenCode from the plugin directory. No additional setup is required.

### Testing

To test the plugin:

1. Configure Snowflake MCP server
2. Set up `.snowflake-proxy/config.yaml`
3. Start OpenCode with a Snowflake MCP client
4. Call a Snowflake tool (e.g., `snowflake_execute_sql`)
5. Check `.snowflake-proxy/logs/audit.md` for audit entries
6. Verify row data is stripped from SELECT queries

### Debug Logging

To enable debug logging:

```yaml
logging:
  log_level: "debug"
```

## Performance

- **Tool Discovery**: ~50-100ms (cached after first run)
- **Query Classification**: <1ms
- **Exclusion Check**: <5ms
- **Row Data Stripping**: ~10-50ms (depending on row count)
- **VARIANT Inference**: ~100-500ms (depending on sample size)
- **Total Overhead**: <100ms per query (typical)

## Security Considerations

- **No Row Data Exposure**: All row data is stripped from responses before being returned to agents
- **Exclusion Pattern Enforcement**: Protected objects cannot be accessed
- **Confirmation Gates**: Destructive operations require user approval
- **Audit Logging**: All interactions are logged for review
- **No Bypass**: Proxy operates at the OpenCode level with no bypass mechanism

## References

- [OpenCode Plugin System](https://github.com/anomalyco/opencode)
- [OpenCode SDK API](https://github.com/anomalyco/opencode/tree/main/sdk)
- [Snowflake Labs MCP Server](https://github.com/Snowflake-Labs/mcp)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)

## License

This plugin is part of the SDAIDF (Spec-Driven AI Development Framework) project.

## Version

**Version**: 1.0.0
**Date**: February 19, 2026
