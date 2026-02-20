import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createExclusionChecker, extractObjectNames } from '../../metadata-proxy/exclusion-checker.js';

describe('Exclusion Checker', () => {
  describe('createExclusionChecker', () => {
    describe('pattern-based exclusion', () => {
      it('excludes objects matching PROD_ prefix pattern', () => {
        const checker = createExclusionChecker(['^PROD_'], []);
        assert.strictEqual(checker.isExcluded('PROD_users'), true);
        assert.strictEqual(checker.isExcluded('PROD_orders'), true);
      });

      it('excludes objects matching _PROD$ suffix pattern', () => {
        const checker = createExclusionChecker(['_PROD$'], []);
        assert.strictEqual(checker.isExcluded('users_PROD'), true);
        assert.strictEqual(checker.isExcluded('orders_PROD'), true);
      });

      it('excludes objects matching _BACKUP$ suffix pattern', () => {
        const checker = createExclusionChecker(['_BACKUP$'], []);
        assert.strictEqual(checker.isExcluded('table_BACKUP'), true);
      });

      it('excludes objects matching _ARCHIVE$ suffix pattern', () => {
        const checker = createExclusionChecker(['_ARCHIVE$'], []);
        assert.strictEqual(checker.isExcluded('old_data_ARCHIVE'), true);
      });

      it('allows objects not matching any pattern', () => {
        const checker = createExclusionChecker(['^PROD_', '_PROD$'], []);
        assert.strictEqual(checker.isExcluded('dev_users'), false);
        assert.strictEqual(checker.isExcluded('staging_orders'), false);
        assert.strictEqual(checker.isExcluded('test_table'), false);
      });

      it('is case insensitive with string patterns', () => {
        const checker = createExclusionChecker(['^prod_'], []);
        assert.strictEqual(checker.isExcluded('PROD_users'), true);
        assert.strictEqual(checker.isExcluded('prod_users'), true);
      });

      it('handles RegExp patterns directly', () => {
        const checker = createExclusionChecker([/^SYSTEM_/i], []);
        assert.strictEqual(checker.isExcluded('SYSTEM_config'), true);
        assert.strictEqual(checker.isExcluded('system_settings'), true);
      });

      it('returns matched pattern in result', () => {
        const checker = createExclusionChecker(['^PROD_'], []);
        const result = checker.check('PROD_users');
        assert.strictEqual(result.isExcluded, true);
        assert.strictEqual(result.matchedPattern, '^PROD_');
      });
    });

    describe('object type exclusion', () => {
      it('excludes objects matching objectTypes', () => {
        const checker = createExclusionChecker([], ['SNAPSHOT']);
        assert.strictEqual(checker.isExcluded('SNAPSHOT'), true);
        assert.strictEqual(checker.isExcluded('snapshot'), true);
      });

      it('allows objects not in objectTypes list', () => {
        const checker = createExclusionChecker([], ['SNAPSHOT']);
        assert.strictEqual(checker.isExcluded('TABLE'), false);
        assert.strictEqual(checker.isExcluded('VIEW'), false);
      });

      it('combines pattern and objectType exclusion', () => {
        const checker = createExclusionChecker(['^PROD_'], ['SNAPSHOT']);
        assert.strictEqual(checker.isExcluded('PROD_data'), true);
        assert.strictEqual(checker.isExcluded('SNAPSHOT'), true);
        assert.strictEqual(checker.isExcluded('dev_table'), false);
      });
    });

    describe('check method', () => {
      it('returns full exclusion result with matched pattern', () => {
        const checker = createExclusionChecker(['^PROD_', '_BACKUP$'], []);
        const result = checker.check('orders_BACKUP');
        assert.strictEqual(result.isExcluded, true);
        assert.strictEqual(result.matchedPattern, '_BACKUP$');
      });

      it('returns non-excluded result for allowed objects', () => {
        const checker = createExclusionChecker(['^PROD_'], []);
        const result = checker.check('dev_table');
        assert.strictEqual(result.isExcluded, false);
        assert.strictEqual(result.matchedPattern, undefined);
      });
    });
  });

  describe('extractObjectNames', () => {
    it('extracts table name from simple SELECT', () => {
      const result = extractObjectNames('SELECT * FROM users');
      assert.deepStrictEqual(result, ['users']);
    });

    it('extracts table name from SELECT with schema', () => {
      const result = extractObjectNames('SELECT * FROM schema.users');
      assert.deepStrictEqual(result, ['schema.users']);
    });

    it('extracts table name from SELECT with database.schema', () => {
      const result = extractObjectNames('SELECT * FROM db.schema.users');
      assert.deepStrictEqual(result, ['db.schema.users']);
    });

    it('extracts multiple tables from JOIN', () => {
      const result = extractObjectNames('SELECT * FROM users u JOIN orders o ON u.id = o.user_id');
      assert.deepStrictEqual(result, ['users', 'orders']);
    });

    it('extracts table from LEFT JOIN', () => {
      const result = extractObjectNames('SELECT * FROM users LEFT JOIN preferences ON users.id = preferences.user_id');
      assert.deepStrictEqual(result, ['users', 'preferences']);
    });

    it('extracts table from RIGHT JOIN', () => {
      const result = extractObjectNames('SELECT * FROM orders RIGHT JOIN customers ON orders.customer_id = customers.id');
      assert.deepStrictEqual(result, ['orders', 'customers']);
    });

    it('extracts table from INNER JOIN', () => {
      const result = extractObjectNames('SELECT * FROM a INNER JOIN b ON a.id = b.a_id');
      assert.deepStrictEqual(result, ['a', 'b']);
    });

    it('extracts table from FULL OUTER JOIN', () => {
      const result = extractObjectNames('SELECT * FROM x FULL OUTER JOIN y ON x.id = y.x_id');
      assert.deepStrictEqual(result, ['x', 'y']);
    });

    it('extracts table name from INSERT INTO', () => {
      const result = extractObjectNames('INSERT INTO users (name) VALUES (\'test\')');
      assert.deepStrictEqual(result, ['users']);
    });

    it('extracts table name from CREATE TABLE', () => {
      const result = extractObjectNames('CREATE TABLE new_users (id INT, name STRING)');
      assert.deepStrictEqual(result, ['new_users']);
    });

    it('extracts table name from ALTER TABLE', () => {
      const result = extractObjectNames('ALTER TABLE users ADD COLUMN age INT');
      assert.deepStrictEqual(result, ['users']);
    });

    it('extracts table name from DROP TABLE', () => {
      const result = extractObjectNames('DROP TABLE old_users');
      assert.deepStrictEqual(result, ['old_users']);
    });

    it('removes quoted identifiers', () => {
      const result = extractObjectNames('SELECT * FROM "users"');
      assert.deepStrictEqual(result, ['users']);
    });

    it('removes backtick identifiers', () => {
      const result = extractObjectNames('SELECT * FROM `users`');
      assert.deepStrictEqual(result, ['users']);
    });

    it('deduplicates table names', () => {
      const result = extractObjectNames('SELECT * FROM users u JOIN users_history h ON u.id = h.user_id');
      assert.deepStrictEqual(result, ['users', 'users_history']);
    });

    it('handles multiple statements', () => {
      const result = extractObjectNames('SELECT * FROM users; SELECT * FROM orders');
      assert.deepStrictEqual(result, ['users', 'orders']);
    });

    it('returns empty array for no matches', () => {
      const result = extractObjectNames('SELECT 1');
      assert.deepStrictEqual(result, []);
    });
  });
});
