/**
 * Unit tests for exclusion-checker.ts
 */
import { describe, it, expect } from 'vitest'
import { checkExclusions } from './exclusion-checker'

describe('Exclusion Checker', () => {
  describe('checkExclusions', () => {
    describe('PROD pattern matching', () => {
      it('should block queries on PROD database', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM PROD.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
        expect(result.reason).toContain('PROD.orders')
        expect(result.reason).toContain('PROD\\..*')
      })

      it('should block queries on PROD with schema', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM PROD.analytics.customers'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should allow queries on non-PROD database', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM DEV.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(false)
      })
    })

    describe('_PROD suffix pattern matching', () => {
      it('should block tables ending with _PROD', () => {
        const patterns = ['.*_PROD']
        const sql = 'SELECT * FROM analytics.orders_PROD'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
        expect(result.reason).toContain('orders_PROD')
        expect(result.reason).toContain('.*_PROD')
      })

      it('should allow tables not ending with _PROD', () => {
        const patterns = ['.*_PROD']
        const sql = 'SELECT * FROM analytics.orders_dev'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(false)
      })
    })

    describe('_BACKUP suffix pattern matching', () => {
      it('should block tables ending with _BACKUP', () => {
        const patterns = ['.*_BACKUP']
        const sql = 'SELECT * FROM analytics.orders_backup'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
        expect(result.reason).toContain('orders_backup')
        expect(result.reason).toContain('.*_BACKUP')
      })

      it('should allow tables not ending with _BACKUP', () => {
        const patterns = ['.*_BACKUP']
        const sql = 'SELECT * FROM analytics.orders_main'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(false)
      })
    })

    describe('Multiple object references', () => {
      it('should block if any object matches pattern', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM DEV.orders JOIN PROD.customers ON orders.customer_id = customers.id'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
        expect(result.reason).toContain('PROD.customers')
      })

      it('should allow if no objects match pattern', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM DEV.orders JOIN DEV.customers ON orders.customer_id = customers.id'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(false)
      })
    })

    describe('Case-insensitive pattern matching', () => {
      it('should block with uppercase table name', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM PROD.ORDERS'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should block with mixed case table name', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM Prod.Orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should block with lowercase table name', () => {
        const patterns = ['prod\\..*']
        const sql = 'select * from prod.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })
    })

    describe('Edge cases', () => {
      it('should allow when no patterns provided', () => {
        const patterns: string[] = []
        const sql = 'SELECT * FROM PROD.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(false)
      })

      it('should allow when patterns array is empty', () => {
        const patterns = []
        const sql = 'SELECT * FROM any_table'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(false)
      })

      it('should handle empty SQL query', () => {
        const patterns = ['PROD\\..*']
        const sql = ''
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(false)
      })

      it('should handle SQL with only comments', () => {
        const patterns = ['PROD\\..*']
        const sql = '-- Select from PROD\nSELECT * FROM DEV.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(false) // Comments don't contain object references
      })

      it('should handle invalid regex patterns gracefully', () => {
        const patterns = ['PROD\\..*', '[invalid(regex']  // Invalid regex
        const sql = 'SELECT * FROM PROD.orders'
        // Should log error but not crash
        const result = checkExclusions(sql, patterns)
        // Invalid pattern should be skipped, query blocked by first valid pattern
        expect(result.blocked).toBe(true)
      })
    })

    describe('Complex SQL patterns', () => {
      it('should extract object from FROM clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM PROD.orders WHERE status = "active"'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from JOIN clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM analytics.orders JOIN PROD.customers ON orders.customer_id = customers.id'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from UPDATE clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'UPDATE PROD.orders SET status = "archived" WHERE id = 1'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from INSERT clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'INSERT INTO PROD.orders SELECT * FROM staging.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from DELETE clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'DELETE FROM PROD.orders WHERE created_at < "2024-01-01"'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from TRUNCATE clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'TRUNCATE TABLE PROD.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from MERGE clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'MERGE INTO PROD.orders USING staging.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from DROP clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'DROP TABLE IF EXISTS PROD.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from CREATE clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'CREATE TABLE IF NOT EXISTS PROD.orders (id NUMBER)'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from ALTER clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'ALTER TABLE PROD.orders ADD COLUMN email VARCHAR(255)'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should extract object from DESCRIBE clause', () => {
        const patterns = ['PROD\\..*']
        const sql = 'DESCRIBE TABLE PROD.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })
    })

    describe('Special characters in object names', () => {
      it('should handle object names with dots', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM "PROD.db.schema".table'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should handle schema.table notation', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM PROD.analytics.orders'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })

      it('should handle quoted object names', () => {
        const patterns = ['PROD\\..*']
        const sql = 'SELECT * FROM "PROD.orders"'
        const result = checkExclusions(sql, patterns)
        expect(result.blocked).toBe(true)
      })
    })
  })
})
