# Testing Plan - Snow CLI MCP Server (Phase 6)

**Version:** 1.0  
**Date:** February 20, 2026  
**Status:** Ready for Implementation

---

## 1. Overview

This document defines the complete testing strategy for the Snow CLI MCP Server, implementing Phase 6 of the architecture. The testing approach prioritizes **security** (zero data leakage) and **reliability** (real Snowflake integration).

---

## 2. Test Environment

### 2.1 Snowflake Connection

| Parameter | Value |
|-----------|-------|
| Connection Name | `` |
| Account | `qxc53909.us-east-1` |
| Role | `SYSADMIN` |
| Test Database | `PROXY_TEST` |

### 2.2 Available Test Objects

```
PROXY_TEST.PUBLIC:
- ALTERABLE_TABLE
- CUSTOMERS
- DATA_PROD (exclusion pattern test)
- ORDERS
- PROD_RESTRICTED (exclusion pattern test)
- TEMP_DROPPABLE

PROXY_TEST.VARIANT_TEST:
- EVENTS (VARIANT column testing)
```

---

## 3. Security Requirements (CRITICAL)

### 3.1 Zero Data Leakage

| Requirement | Implementation |
|-------------|----------------|
| No row data in `execute_sql` responses | All SELECT results redacted to metadata only |
| No credentials exposed | Connection details stripped from all responses |
| Exclusion patterns enforced | Block queries on PROD_*, *_PROD, *_BACKUP objects |

### 3.2 Security Test Cases

```typescript
describe('SECURITY: No Data Leakage', () => {
  it('execute_sql redacts SELECT * results completely')
  it('execute_sql returns only column metadata, no rows')
  it('Response contains NO connection name')
  it('Response contains NO account identifier')
  it('Response contains NO user credentials')
  it('PROD_RESTRICTED table blocked by exclusion pattern')
  it('DATA_PROD table blocked by exclusion pattern')
})
```

---

## 4. Gap Fixes Applied

Before test implementation, the following gaps were closed:

| Gap | Fix | File |
|-----|-----|------|
| Weak hash function | Replaced `simpleHash` with SHA-256 | `sync-tools.ts` |
| No CLI timeout | Added 30s default timeout | `command-executor.ts` |
| DDL regex bugs | Fixed typo, added MATERIALIZED_VIEW | `ddl-tools.ts` |
| Limited object extraction | Added JOIN, subquery support | `exclusion-checker.ts` |

---

## 5. Test Suite Structure

```
src/mcp/tests/
├── unit/                           # Fast, no external deps
│   ├── query-classifier.test.ts    # 100% coverage target
│   ├── exclusion-checker.test.ts   # 100% coverage target
│   ├── result-redactor.test.ts     # 90%+ coverage target
│   └── config.test.ts              # 90%+ coverage target
├── tools/                          # Mocked snow CLI
│   ├── execute-sql.test.ts
│   ├── execute-scalar.test.ts
│   ├── list-objects.test.ts
│   ├── describe-object.test.ts
│   ├── get-ddl.test.ts
│   ├── get-lineage.test.ts
│   ├── get-dependencies.test.ts
│   ├── sync-objects.test.ts
│   ├── check-staleness.test.ts
│   └── execute-ddl.test.ts
├── security/                       # Critical security tests
│   ├── no-credentials-in-response.test.ts
│   ├── exclusion-enforcement.test.ts
│   ├── data-leakage-prevention.test.ts
│   └── prompt-injection.test.ts
├── integration/                    # Live tests
│   ├── live-connection.test.ts
│   └── sync-workflow.test.ts
├── fixtures/
│   ├── queries/
│   ├── config/
│   └── results/
├── logs/                          # Test execution logs
└── run-tests.ts
```

---

## 6. Test Categories

### 6.1 Unit Tests (90%+ Coverage)

| Module | Tests | Priority |
|--------|-------|----------|
| Query Classifier | 15+ test cases | Critical |
| Exclusion Checker | 20+ test cases | Critical |
| Result Redactor | 10+ test cases | High |
| Config | 8+ test cases | Medium |

### 6.2 Tool Tests (90%+ Coverage)

Each tool includes:
- Happy path tests
- Error handling tests
- Edge case tests
- Security validation tests

### 6.3 Security Tests (100% Coverage Required)

| Test | Objective | Validation |
|------|-----------|-------------|
| No credentials in response | Ensure connection details never exposed | Response contains no sensitive data |
| Exclusion enforcement | Verify PROD_* objects blocked | Blocked objects return error |
| Data leakage prevention | Verify SELECT results fully redacted | No row data in response |
| DDL safety | Verify dangerous ops detected | DROP/TRUNCATE returns warning |

### 6.4 Integration Tests (80%+ Coverage)

| Test | Objective |
|------|-----------|
| Live connection | Verify MCP server connects to real Snowflake |
| Sync workflow | Test full sync_objects workflow |
| DDL execution | Test execute_ddl with real objects |

---

## 7. Test Log Format

Every test execution produces a detailed log:

```markdown
# Test Run: 2026-02-20T15:30:00Z
# Environment:  (PROXY_TEST)
# Framework: Node.js native test

## Test: execute_sql_rejects_prod_table
### Objective
Verify that queries on PROD_RESTRICTED table are blocked by exclusion pattern

### Input
- Query: SELECT * FROM PROXY_TEST.PUBLIC.PROD_RESTRICTED
- Connection: 

### Expected Outcome
- Status: ERROR
- Error Code: EXCLUDED_OBJECT
- Message: Object matches exclusion pattern

### Actual Outcome
- Status: ERROR (PASS)
- Error Code: EXCLUDED_OBJECT
- Message: Object 'PROD_RESTRICTED' matches exclusion pattern '^PROD_'
- Duration: 245ms

### Security Check
- Connection exposed: NO
- Credentials visible: NO
- Data leaked: NO

### Observations
Exclusion pattern correctly identifies prefix match '^PROD_'

---
```

---

## 8. Test Execution Commands

```bash
# All tests
npm test

# Unit tests only (fast)
npm run test:unit

# Tool tests (mocked)
npm run test:tools

# Security tests (critical)
npm run test:security

# Integration tests (requires Snowflake)
npm run test:integration

# Coverage report
npm run test:coverage
```

---

## 9. Success Criteria

| Metric | Target |
|--------|--------|
| Unit test coverage | 90%+ |
| Security test coverage | 100% |
| Tool test coverage | 90%+ |
| Integration test coverage | 80%+ |
| All security tests | PASS |
| All unit tests | PASS |

---

## 10. Notes

- Tests utilize Node.js native test runner (no additional dependencies needed)
- Mock-based tests run without Snowflake connection
- Integration tests run against live `` connection
- All test results logged to `tests/logs/` directory
- Security tests MUST pass before any deployment

---

## 11. Test Implementation Order

1. Set up test framework and dependencies
2. Implement unit tests (query-classifier, exclusion-checker)
3. Implement security tests
4. Implement tool tests (mocked)
5. Run live integration tests
6. Generate test logs and coverage report

---

*This testing plan ensures the MCP server meets all security requirements while providing comprehensive functional coverage.*
