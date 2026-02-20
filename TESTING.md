# Testing Criteria for Snow CLI MCP Server

## Test Coverage Targets

| Category | Target |
|----------|--------|
| Query Classifier | 100% |
| Exclusion Checker | 100% |
| Result Redactor | 90%+ |
| CLI Executor | 90%+ |
| MCP Tools | 90%+ |
| Integration | 80%+ |
| Security (Data Leakage Prevention) | 100% |

---

## Unit Test Requirements

### Query Classifier Tests

| Test Case | Expected Result |
|-----------|----------------|
| `SELECT COUNT(*) FROM users` | scalar |
| `SELECT * FROM users` | data |
| `SELECT * FROM INFORMATION_SCHEMA.TABLES` | metadata |
| `GET_DDL('TABLE', 'users')` | metadata |
| `DESCRIBE TABLE users` | metadata |
| `SELECT CURRENT_TIMESTAMP` | scalar |

### Exclusion Checker Tests

| Test Case | Pattern | Expected |
|-----------|---------|----------|
| `PROD_USERS` | `^PROD_` | excluded |
| `USERS_PROD` | `_PROD$` | excluded |
| `BACKUP_2024` | `_BACKUP$` | excluded |
| `USERS_ARCHIVE` | `_ARCHIVE$` | excluded |
| `SYSTEM_CONFIG` | `^SYSTEM_` | excluded |
| `DEV_USERS` | (none) | allowed |

### Result Redactor Tests

| Input | Expected Output |
|-------|-----------------|
| `[{"id": 1, "name": "John"}]` | `{metadata: {columns: [...]}, data: []}` |
| `SELECT * FROM users` (data query) | redacted rows |
| `SELECT COUNT(*) FROM users` | unredacted (scalar) |

---

## Integration Test Requirements

### MCP Server Tests

- Server starts successfully with STDIO transport
- `execute_sql` tool returns redacted results for data queries
- `execute_sql` tool returns unredacted for metadata queries
- `execute_scalar` tool returns actual values
- Exclusion patterns correctly block queries

### Security Tests

- No row data leaks through `execute_sql` for data queries
- Exclusion patterns enforced before query execution
- Error messages don't expose sensitive information

---

## Test Execution

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:security
```

---

## Notes

- Tests should use mocking for Snow CLI calls
- Security tests should verify zero data leakage
- Integration tests require mock Snowflake connection
