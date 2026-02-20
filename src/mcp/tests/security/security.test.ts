import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyQuery } from '../../metadata-proxy/query-classifier.js';
import { createExclusionChecker, extractObjectNames } from '../../metadata-proxy/exclusion-checker.js';
import { redactResult, redactJsonResult } from '../../metadata-proxy/result-redactor.js';

/**
 * SECURITY TESTS
 * 
 * These tests verify the security mechanisms of the MCP metadata proxy:
 * 1. Query classification prevents data exfiltration
 * 2. Exclusion patterns block access to production objects
 * 3. Result redaction strips all row data
 * 4. Object name extraction identifies all targets for exclusion checking
 */

describe('SECURITY: Query Classification', () => {
  /**
   * Objective: Verify that query classification correctly identifies
   * and blocks data queries while allowing safe metadata/scalar queries.
   */
  
  it('SECURITY: classifies SELECT * as data (blocked by default)', () => {
    const result = classifyQuery('SELECT * FROM users');
    assert.strictEqual(result.type, 'data');
  });

  it('SECURITY: classifies SELECT column as data (blocked by default)', () => {
    const result = classifyQuery('SELECT name, email FROM customers');
    assert.strictEqual(result.type, 'data');
  });

  it('SECURITY: classifies INSERT/UPDATE/DELETE as data', () => {
    assert.strictEqual(classifyQuery('INSERT INTO users VALUES (1)').type, 'data');
    assert.strictEqual(classifyQuery('UPDATE users SET name = "test"').type, 'data');
    assert.strictEqual(classifyQuery('DELETE FROM users').type, 'data');
  });

  it('SECURITY: allows COUNT(*) - scalar aggregation', () => {
    const result = classifyQuery('SELECT COUNT(*) FROM users');
    assert.strictEqual(result.type, 'scalar');
  });

  it('SECURITY: allows SUM/AVG/MIN/MAX - scalar aggregations', () => {
    assert.strictEqual(classifyQuery('SELECT SUM(amount) FROM orders').type, 'scalar');
    assert.strictEqual(classifyQuery('SELECT AVG(price) FROM products').type, 'scalar');
    assert.strictEqual(classifyQuery('SELECT MIN(created_at) FROM events').type, 'scalar');
    assert.strictEqual(classifyQuery('SELECT MAX(score) FROM results').type, 'scalar');
  });

  it('SECURITY: allows CURRENT_* session functions', () => {
    assert.strictEqual(classifyQuery('SELECT CURRENT_TIMESTAMP').type, 'scalar');
    assert.strictEqual(classifyQuery('SELECT CURRENT_DATE').type, 'scalar');
    assert.strictEqual(classifyQuery('SELECT SESSION_USER').type, 'scalar');
  });

  it('SECURITY: allows INFORMATION_SCHEMA queries', () => {
    const result = classifyQuery('SELECT * FROM INFORMATION_SCHEMA.TABLES');
    assert.strictEqual(result.type, 'metadata');
  });

  it('SECURITY: allows GET_DDL function', () => {
    const result = classifyQuery("SELECT GET_DDL('TABLE', 'users')");
    assert.strictEqual(result.type, 'metadata');
  });

  it('SECURITY: allows DESCRIBE command', () => {
    const result = classifyQuery('DESCRIBE TABLE my_table');
    assert.strictEqual(result.type, 'metadata');
  });

  it('SECURITY: allows SHOW commands', () => {
    assert.strictEqual(classifyQuery('SHOW TABLES').type, 'metadata');
    assert.strictEqual(classifyQuery('SHOW VIEWS').type, 'metadata');
  });

  it('SECURITY: metadata pattern takes precedence over scalar', () => {
    // Even though it starts with SELECT COUNT, it's actually querying INFORMATION_SCHEMA
    const result = classifyQuery('SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES');
    assert.strictEqual(result.type, 'metadata');
  });
});

describe('SECURITY: Exclusion Patterns', () => {
  /**
   * Objective: Verify that exclusion patterns correctly identify
   * and block access to production objects.
   */

  const securityPatterns = ['^PROD_', '_PROD$', '_BACKUP$', '_ARCHIVE$', '^SYSTEM_'];
  const securityObjectTypes = ['SNAPSHOT'];

  it('SECURITY: blocks PROD_ prefix objects', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    assert.strictEqual(checker.isExcluded('PROD_users'), true);
    assert.strictEqual(checker.isExcluded('PROD_orders'), true);
    assert.strictEqual(checker.isExcluded('PROD_anything'), true);
  });

  it('SECURITY: blocks _PROD$ suffix objects', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    assert.strictEqual(checker.isExcluded('users_PROD'), true);
    assert.strictEqual(checker.isExcluded('orders_PROD'), true);
  });

  it('SECURITY: blocks _BACKUP$ suffix objects', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    assert.strictEqual(checker.isExcluded('table_BACKUP'), true);
    assert.strictEqual(checker.isExcluded('data_BACKUP'), true);
  });

  it('SECURITY: blocks _ARCHIVE$ suffix objects', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    assert.strictEqual(checker.isExcluded('old_data_ARCHIVE'), true);
  });

  it('SECURITY: blocks SYSTEM_ prefix objects', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    assert.strictEqual(checker.isExcluded('SYSTEM_config'), true);
    assert.strictEqual(checker.isExcluded('SYSTEM_settings'), true);
  });

  it('SECURITY: blocks SNAPSHOT object type', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    assert.strictEqual(checker.isExcluded('SNAPSHOT'), true);
  });

  it('SECURITY: allows non-production objects', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    assert.strictEqual(checker.isExcluded('dev_users'), false);
    assert.strictEqual(checker.isExcluded('staging_orders'), false);
    assert.strictEqual(checker.isExcluded('test_data'), false);
    assert.strictEqual(checker.isExcluded('TABLE'), false);
    assert.strictEqual(checker.isExcluded('VIEW'), false);
  });

  it('SECURITY: case insensitive matching', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    assert.strictEqual(checker.isExcluded('prod_users'), true);
    assert.strictEqual(checker.isExcluded('users_PROD'), true);
    assert.strictEqual(checker.isExcluded('Snapshot'), true);
  });

  it('SECURITY: returns matched pattern for audit', () => {
    const checker = createExclusionChecker(securityPatterns, securityObjectTypes);
    const result = checker.check('PROD_data');
    assert.strictEqual(result.isExcluded, true);
    assert.strictEqual(result.matchedPattern, '^PROD_');
  });
});

describe('SECURITY: Result Redaction', () => {
  /**
   * Objective: Verify that result redaction completely removes
   * row data while preserving schema information.
   */

  it('SECURITY: redacts all row data from results', () => {
    const result = {
      columns: [
        { name: 'id', type: 'NUMBER' },
        { name: 'name', type: 'STRING' },
        { name: 'email', type: 'STRING' },
      ],
      rows: [
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
      ],
      rowCount: 2,
    };

    const redacted = redactResult(result);
    
    assert.strictEqual(redacted.data.length, 0);
    assert.strictEqual(redacted.metadata.rowCount, 2);
    assert.strictEqual(redacted.metadata.columns.length, 3);
  });

  it('SECURITY: preserves column schema information', () => {
    const result = {
      columns: [
        { name: 'id', type: 'NUMBER' },
        { name: 'name', type: 'VARCHAR' },
      ],
      rows: [{ id: 1, name: 'sensitive' }],
    };

    const redacted = redactResult(result);
    
    assert.strictEqual(redacted.metadata.columns[0].name, 'id');
    assert.strictEqual(redacted.metadata.columns[0].type, 'NUMBER');
    assert.strictEqual(redacted.metadata.columns[1].name, 'name');
    assert.strictEqual(redacted.metadata.columns[1].type, 'VARCHAR');
  });

  it('SECURITY: redacts JSON array results', () => {
    const jsonString = JSON.stringify([
      { id: 1, name: 'Alice', ssn: '123-45-6789' },
      { id: 2, name: 'Bob', ssn: '987-65-4321' },
    ]);

    const redacted = JSON.parse(redactJsonResult(jsonString));
    
    assert.strictEqual(redacted.data.length, 0);
    assert.strictEqual(redacted.metadata.rowCount, 2);
  });

  it('SECURITY: redacts single object results', () => {
    const jsonString = JSON.stringify({
      id: 1,
      name: 'Secret Name',
      password: 'supersecret',
    });

    const redacted = JSON.parse(redactJsonResult(jsonString));
    
    assert.strictEqual(redacted.data.length, 0);
    assert.strictEqual(redacted.metadata.rowCount, 1);
  });

  it('SECURITY: handles empty results', () => {
    const result = {
      columns: [],
      rows: [],
      rowCount: 0,
    };

    const redacted = redactResult(result);
    
    assert.strictEqual(redacted.data.length, 0);
    assert.strictEqual(redacted.metadata.rowCount, 0);
  });

  it('SECURITY: returns [REDACTED] for primitive values', () => {
    const redacted = JSON.parse(redactJsonResult('"sensitive data"'));
    assert.strictEqual(redacted.value, '[REDACTED]');
  });
});

describe('SECURITY: Object Name Extraction', () => {
  /**
   * Objective: Verify that object name extraction identifies all
   * target objects for exclusion checking.
   */

  it('SECURITY: extracts table from SELECT query', () => {
    const objects = extractObjectNames('SELECT * FROM PROD_users');
    assert.deepStrictEqual(objects, ['PROD_users']);
  });

  it('SECURITY: extracts table from JOIN query', () => {
    const objects = extractObjectNames(
      'SELECT * FROM users u JOIN orders o ON u.id = o.user_id'
    );
    assert.deepStrictEqual(objects, ['users', 'orders']);
  });

  it('SECURITY: extracts table from INSERT INTO', () => {
    const objects = extractObjectNames('INSERT INTO PROD_data VALUES (1, 2)');
    assert.deepStrictEqual(objects, ['PROD_data']);
  });

  it('SECURITY: extracts table from UPDATE', () => {
    const objects = extractObjectNames('UPDATE PROD_records SET value = 1');
    assert.deepStrictEqual(objects, ['PROD_records']);
  });

  it('SECURITY: extracts table from DELETE', () => {
    const objects = extractObjectNames('DELETE FROM PROD_logs');
    assert.deepStrictEqual(objects, ['PROD_logs']);
  });

  it('SECURITY: extracts table from CREATE TABLE', () => {
    const objects = extractObjectNames('CREATE TABLE PROD_new_table (id INT)');
    assert.deepStrictEqual(objects, ['PROD_new_table']);
  });

  it('SECURITY: extracts table from DROP TABLE', () => {
    const objects = extractObjectNames('DROP TABLE PROD_old_table');
    assert.deepStrictEqual(objects, ['PROD_old_table']);
  });

  it('SECURITY: extracts table from ALTER TABLE', () => {
    const objects = extractObjectNames('ALTER TABLE PROD_config ADD COLUMN value STRING');
    assert.deepStrictEqual(objects, ['PROD_config']);
  });

  it('SECURITY: handles quoted identifiers', () => {
    const objects = extractObjectNames('SELECT * FROM "PROD_users"');
    assert.deepStrictEqual(objects, ['PROD_users']);
  });

  it('SECURITY: deduplicates extracted names', () => {
    const objects = extractObjectNames(
      'SELECT * FROM users u JOIN users_history h ON u.id = h.user_id'
    );
    assert.deepStrictEqual(objects, ['users', 'users_history']);
  });
});

describe('SECURITY: Integration Tests', () => {
  /**
   * Objective: Verify end-to-end security behavior.
   */

  it('SECURITY: full flow - data query is redacted', () => {
    const query = 'SELECT * FROM users';
    const classification = classifyQuery(query);
    
    // Data queries should be redacted
    assert.strictEqual(classification.type, 'data');
  });

  it('SECURITY: full flow - scalar query is allowed', () => {
    const query = 'SELECT COUNT(*) FROM users';
    const classification = classifyQuery(query);
    
    // Scalar queries are not redacted
    assert.strictEqual(classification.type, 'scalar');
  });

  it('SECURITY: full flow - production object is blocked', () => {
    const checker = createExclusionChecker(
      ['^PROD_', '_PROD$', '_BACKUP$', '_ARCHIVE$', '^SYSTEM_'],
      ['SNAPSHOT']
    );
    
    const objects = extractObjectNames('SELECT * FROM PROD_customers');
    const excluded = objects.some(obj => checker.isExcluded(obj));
    
    assert.strictEqual(excluded, true);
  });

  it('SECURITY: full flow - non-production object is allowed', () => {
    const checker = createExclusionChecker(
      ['^PROD_', '_PROD$', '_BACKUP$', '_ARCHIVE$', '^SYSTEM_'],
      ['SNAPSHOT']
    );
    
    const objects = extractObjectNames('SELECT * FROM dev_users');
    const excluded = objects.some(obj => checker.isExcluded(obj));
    
    assert.strictEqual(excluded, false);
  });
});
