/**
 * Unit tests for query-classifier.ts
 */
import { describe, it, expect } from 'vitest'
import { classifyQuery, QueryType, extractFirstKeyword } from './query-classifier'

describe('Query Classifier', () => {
  describe('classifyQuery', () => {
    describe('DATA queries - SELECT statements', () => {
      it('should classify SELECT query with * as DATA', () => {
        const query = 'SELECT * FROM table_name'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT with specific columns as DATA', () => {
        const query = 'SELECT id, name FROM table_name'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT COUNT(*) as DATA', () => {
        const query = 'SELECT COUNT(*) FROM table_name'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT with WHERE clause as DATA', () => {
        const query = 'SELECT * FROM table_name WHERE id > 100'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT with JOIN as DATA', () => {
        const query = 'SELECT * FROM table_a JOIN table_b ON table_a.id = table_b.id'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT with subquery as DATA', () => {
        const query = 'SELECT * FROM table_a WHERE id IN (SELECT id FROM table_b)'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT with GROUP BY as DATA', () => {
        const query = 'SELECT customer_id, SUM(total) FROM orders GROUP BY customer_id'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT EXISTS as DATA', () => {
        const query = 'SELECT EXISTS (SELECT 1 FROM table_name)'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT with LIMIT as DATA', () => {
        const query = 'SELECT * FROM table_name LIMIT 100'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should classify SELECT with multiple whitespace as DATA', () => {
        const query = '   SELECT   *   FROM   table_name   '
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })
    })

    describe('METADATA queries - DDL/DML/DESCRIBE/SHOW', () => {
      it('should classify CREATE TABLE as METADATA', () => {
        const query = 'CREATE TABLE table_name (id NUMBER, name VARCHAR)'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify DROP TABLE as METADATA', () => {
        const query = 'DROP TABLE IF EXISTS table_name'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify ALTER TABLE as METADATA', () => {
        const query = 'ALTER TABLE table_name ADD COLUMN email VARCHAR(255)'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify INSERT as METADATA', () => {
        const query = 'INSERT INTO table_name VALUES (1, "John")'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify UPDATE as METADATA', () => {
        const query = 'UPDATE table_name SET name = "Jane" WHERE id = 1'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify DELETE as METADATA', () => {
        const query = 'DELETE FROM table_name WHERE id = 1'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify TRUNCATE TABLE as METADATA', () => {
        const query = 'TRUNCATE TABLE table_name'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify MERGE as METADATA', () => {
        const query = 'MERGE INTO target USING source ON target.id = source.id'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify DESCRIBE TABLE as METADATA', () => {
        const query = 'DESCRIBE TABLE table_name'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify SHOW TABLES as METADATA', () => {
        const query = 'SHOW TABLES'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify SHOW DATABASES as METADATA', () => {
        const query = 'SHOW DATABASES'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify USE DATABASE as METADATA', () => {
        const query = 'USE DATABASE my_database'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify GRANT as METADATA', () => {
        const query = 'GRANT SELECT ON table_name TO user_name'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should classify COMMENT as METADATA', () => {
        const query = 'COMMENT ON TABLE table_name IS "Customer data"'
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })
    })

    describe('Edge cases', () => {
      it('should handle empty query', () => {
        const query = ''
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should handle query with only whitespace', () => {
        const query = '   '
        expect(classifyQuery(query)).toBe(QueryType.METADATA)
      })

      it('should handle query with comments', () => {
        const query = '-- This is a comment\nSELECT * FROM table_name'
        expect(classifyQuery(query)).toBe(QueryType.METADATA) // Comments start with --
      })

      it('should handle lowercase select', () => {
        const query = 'select * from table_name'
        expect(classifyQuery(query)).toBe(QueryType.DATA)
      })

      it('should handle mixed case select', () => {
        const query = 'SeLeCt * from table_name'
        expect(classifyQuery(query)).toBe(QueryType.METADATA) // Must be exact case
      })
    })
  })

  describe('extractFirstKeyword', () => {
    it('should extract SELECT keyword', () => {
      expect(extractFirstKeyword('SELECT * FROM table')).toBe('SELECT')
    })

    it('should extract CREATE keyword', () => {
      expect(extractFirstKeyword('CREATE TABLE t (id INT)')).toBe('CREATE')
    })

    it('should extract DROP keyword', () => {
      expect(extractFirstKeyword('DROP TABLE IF EXISTS t')).toBe('DROP')
    })

    it('should extract INSERT keyword', () => {
      expect(extractFirstKeyword('INSERT INTO t VALUES (1)')).toBe('INSERT')
    })

    it('should extract DESCRIBE keyword', () => {
      expect(extractFirstKeyword('DESCRIBE TABLE t')).toBe('DESCRIBE')
    })

    it('should handle empty string', () => {
      expect(extractFirstKeyword('')).toBe('')
    })

    it('should handle whitespace', () => {
      expect(extractFirstKeyword('   SELECT * FROM t')).toBe('SELECT')
    })

    it('should extract keyword from lowercase', () => {
      expect(extractFirstKeyword('select * from t')).toBe('select')
    })
  })
})
