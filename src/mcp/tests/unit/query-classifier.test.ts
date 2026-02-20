import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyQuery, isScalarQuery, isMetadataQuery, isDataQuery } from '../../metadata-proxy/query-classifier.js';

describe('Query Classifier', () => {
  describe('classifyQuery', () => {
    it('classifies COUNT(*) as scalar', () => {
      const result = classifyQuery('SELECT COUNT(*) FROM users');
      assert.strictEqual(result.type, 'scalar');
    });

    it('classifies SUM() as scalar', () => {
      const result = classifyQuery('SELECT SUM(amount) FROM orders');
      assert.strictEqual(result.type, 'scalar');
    });

    it('classifies AVG/MIN/MAX as scalar', () => {
      assert.strictEqual(classifyQuery('SELECT AVG(price) FROM products').type, 'scalar');
      assert.strictEqual(classifyQuery('SELECT MIN(created_at) FROM events').type, 'scalar');
      assert.strictEqual(classifyQuery('SELECT MAX(score) FROM results').type, 'scalar');
    });

    it('classifies CURRENT_* as scalar', () => {
      const result = classifyQuery('SELECT CURRENT_TIMESTAMP');
      assert.strictEqual(result.type, 'scalar');
    });

    it('classifies INFORMATION_SCHEMA as metadata', () => {
      const result = classifyQuery('SELECT * FROM INFORMATION_SCHEMA.TABLES');
      assert.strictEqual(result.type, 'metadata');
    });

    it('classifies GET_DDL() as metadata', () => {
      const result = classifyQuery("SELECT GET_DDL('TABLE', 'users')");
      assert.strictEqual(result.type, 'metadata');
    });

    it('classifies DESCRIBE as metadata', () => {
      const result = classifyQuery('DESCRIBE TABLE users');
      assert.strictEqual(result.type, 'metadata');
    });

    it('classifies regular SELECT as data (redacted)', () => {
      const result = classifyQuery('SELECT * FROM users');
      assert.strictEqual(result.type, 'data');
    });

    it('handles case insensitivity', () => {
      assert.strictEqual(classifyQuery('select count(*) from users').type, 'scalar');
      assert.strictEqual(classifyQuery('SELECT * FROM information_schema.tables').type, 'metadata');
    });

    it('handles whitespace variations', () => {
      assert.strictEqual(classifyQuery('  SELECT   COUNT(*)   FROM   users  ').type, 'scalar');
    });
  });

  describe('isScalarQuery', () => {
    it('returns true for scalar queries', () => {
      assert.strictEqual(isScalarQuery('SELECT COUNT(*) FROM users'), true);
      assert.strictEqual(isScalarQuery('SELECT SUM(amount) FROM orders'), true);
    });

    it('returns false for non-scalar queries', () => {
      assert.strictEqual(isScalarQuery('SELECT * FROM users'), false);
      assert.strictEqual(isScalarQuery('SELECT name FROM users'), false);
    });
  });

  describe('isMetadataQuery', () => {
    it('returns true for metadata queries', () => {
      assert.strictEqual(isMetadataQuery('SELECT * FROM INFORMATION_SCHEMA.TABLES'), true);
      assert.strictEqual(isMetadataQuery("SELECT GET_DDL('TABLE', 'users')"), true);
    });

    it('returns false for non-metadata queries', () => {
      assert.strictEqual(isMetadataQuery('SELECT * FROM users'), false);
    });
  });

  describe('isDataQuery', () => {
    it('returns true for data queries', () => {
      assert.strictEqual(isDataQuery('SELECT * FROM users'), true);
      assert.strictEqual(isDataQuery('SELECT name, email FROM users WHERE active = true'), true);
    });

    it('returns false for non-data queries', () => {
      assert.strictEqual(isDataQuery('SELECT COUNT(*) FROM users'), false);
      assert.strictEqual(isDataQuery('SELECT * FROM INFORMATION_SCHEMA.TABLES'), false);
    });
  });
});
