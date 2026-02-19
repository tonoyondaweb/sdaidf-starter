/**
 * Unit tests for destructive-detector.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isDestructive, requestConfirmation } from './destructive-detector'
import type { PluginContext } from './types'

describe('Destructive Detector', () => {
  describe('isDestructive', () => {
    describe('DROP statements', () => {
      it('should detect DROP TABLE as destructive', () => {
        expect(isDestructive('DROP TABLE table_name')).toBe(true)
      })

      it('should detect DROP VIEW as destructive', () => {
        expect(isDestructive('DROP VIEW view_name')).toBe(true)
      })

      it('should detect DROP DATABASE as destructive', () => {
        expect(isDestructive('DROP DATABASE database_name')).toBe(true)
      })

      it('should detect DROP SCHEMA as destructive', () => {
        expect(isDestructive('DROP SCHEMA schema_name')).toBe(true)
      })

      it('should detect DROP with IF EXISTS as destructive', () => {
        expect(isDestructive('DROP TABLE IF EXISTS table_name')).toBe(true)
      })

      it('should detect DROP WAREHOUSE as destructive', () => {
        expect(isDestructive('DROP WAREHOUSE warehouse_name')).toBe(true)
      })

      it('should detect DROP ROLE as destructive', () => {
        expect(isDestructive('DROP ROLE role_name')).toBe(true)
      })

      it('should detect DROP USER as destructive', () => {
        expect(isDestructive('DROP USER user_name')).toBe(true)
      })

      it('should detect DROP STAGE as destructive', () => {
        expect(isDestructive('DROP STAGE stage_name')).toBe(true)
      })

      it('should detect DROP FUNCTION as destructive', () => {
        expect(isDestructive('DROP FUNCTION function_name')).toBe(true)
      })

      it('should detect DROP PROCEDURE as destructive', () => {
        expect(isDestructive('DROP PROCEDURE procedure_name')).toBe(true)
      })
    })

    describe('TRUNCATE statements', () => {
      it('should detect TRUNCATE TABLE as destructive', () => {
        expect(isDestructive('TRUNCATE TABLE table_name')).toBe(true)
      })

      it('should detect TRUNCATE with IF EXISTS as destructive', () => {
        expect(isDestructive('TRUNCATE TABLE IF EXISTS table_name')).toBe(true)
      })
    })

    describe('DELETE statements', () => {
      it('should detect DELETE FROM as destructive', () => {
        expect(isDestructive('DELETE FROM table_name WHERE id = 1')).toBe(true)
      })

      it('should detect DELETE with multiple conditions as destructive', () => {
        expect(isDestructive('DELETE FROM table_name WHERE created_at < "2024-01-01" AND status = "active"')).toBe(true)
      })
    })

    describe('ALTER TABLE statements', () => {
      it('should detect ALTER TABLE ADD COLUMN as destructive', () => {
        expect(isDestructive('ALTER TABLE table_name ADD COLUMN email VARCHAR(255)')).toBe(true)
      })

      it('should detect ALTER TABLE DROP COLUMN as destructive', () => {
        expect(isDestructive('ALTER TABLE table_name DROP COLUMN email')).toBe(true)
      })

      it('should detect ALTER TABLE RENAME COLUMN as destructive', () => {
        expect(isDestructive('ALTER TABLE table_name RENAME COLUMN email TO new_email')).toBe(true)
      })

      it('should detect ALTER TABLE ALTER COLUMN as destructive', () => {
        expect(isDestructive('ALTER TABLE table_name ALTER COLUMN email VARCHAR(500)')).toBe(true)
      })
    })

    describe('MERGE statements', () => {
      it('should detect MERGE INTO as destructive', () => {
        expect(isDestructive('MERGE INTO target_table USING source_table')).toBe(true)
      })

      it('should detect MERGE with ON clause as destructive', () => {
        expect(isDestructive('MERGE INTO target USING source ON target.id = source.id')).toBe(true)
      })
    })

    describe('Non-destructive statements', () => {
      it('should not detect SELECT as destructive', () => {
        expect(isDestructive('SELECT * FROM table_name')).toBe(false)
      })

      it('should not detect INSERT as destructive', () => {
        expect(isDestructive('INSERT INTO table_name VALUES (1)')).toBe(false)
      })

      it('should not detect UPDATE as destructive', () => {
        expect(isDestructive('UPDATE table_name SET name = "John" WHERE id = 1')).toBe(false)
      })

      it('should not detect CREATE TABLE as destructive', () => {
        expect(isDestructive('CREATE TABLE table_name (id NUMBER)')).toBe(false)
      })

      it('should not detect DESCIBE TABLE as destructive', () => {
        expect(isDestructive('DESCRIBE TABLE table_name')).toBe(false)
      })

      it('should not detect SHOW TABLES as destructive', () => {
        expect(isDestructive('SHOW TABLES')).toBe(false)
      })

      it('should not detect USE DATABASE as destructive', () => {
        expect(isDestructive('USE DATABASE my_database')).toBe(false)
      })

      it('should not detect GRANT as destructive', () => {
        expect(isDestructive('GRANT SELECT ON table_name TO user_name')).toBe(false)
      })

      it('should not detect COMMENT as destructive', () => {
        expect(isDestructive('COMMENT ON TABLE table_name IS "Comment"')).toBe(false)
      })
    })

    describe('Case handling', () => {
      it('should handle uppercase DROP', () => {
        expect(isDestructive('DROP TABLE table')).toBe(true)
      })

      it('should handle lowercase drop', () => {
        expect(isDestructive('drop table table')).toBe(false) // Pattern is case-sensitive
      })

      it('should handle mixed case Drop Table', () => {
        expect(isDestructive('Drop Table table')).toBe(false) // Pattern is case-sensitive
      })

      it('should handle TRUNCATE in mixed case', () => {
        expect(isDestructive('TrUnCaTe table table')).toBe(false) // Pattern is case-sensitive
      })
    })

    describe('Edge cases', () => {
      it('should handle empty string', () => {
        expect(isDestructive('')).toBe(false)
      })

      it('should handle string with only whitespace', () => {
        expect(isDestructive('   ')).toBe(false)
      })

      it('should handle SQL with comments before statement', () => {
        expect(isDestructive('-- Comment\nDROP TABLE table')).toBe(false) // First word is --
      })

      it('should handle DROP with multiple whitespace', () => {
        expect(isDestructive('   DROP   TABLE   table')).toBe(true)
      })
    })

    describe('Complex patterns', () => {
      it('should detect destructive in CTE', () => {
        const sql = 'WITH cte AS (SELECT * FROM temp_table) DELETE FROM cte WHERE id < 100'
        expect(isDestructive(sql)).toBe(true)
      })

      it('should detect destructive after UNION', () => {
        const sql = 'SELECT * FROM table_a UNION SELECT * FROM table_b; DROP TABLE temp_table'
        expect(isDestructive(sql)).toBe(true)
      })
    })
  })

  describe('requestConfirmation', () => {
    let mockPluginContext: PluginContext
    let mockPermissionAsk: any

    beforeEach(() => {
      mockPluginContext = {
        client: {
          permission: {
            ask: vi.fn()
          }
        },
        project: {},
        $: {},
        directory: {},
        worktree: {}
      } as any
      mockPermissionAsk = mockPluginContext.client.permission.ask
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    describe('successful confirmation', () => {
      it('should return true when user confirms', async () => {
        mockPermissionAsk.mockResolvedValue(true)

        const result = await requestConfirmation('DROP TABLE table', 'snowflake_execute_sql', mockPluginContext)

        expect(result).toBe(true)
        expect(mockPermissionAsk).toHaveBeenCalledWith({
          tool: 'snowflake_execute_sql',
          action: 'Destructive operation',
          message: expect.stringContaining('DROP TABLE table')
        })
      })
    })

    describe('user denial', () => {
      it('should return false when user denies', async () => {
        mockPermissionAsk.mockResolvedValue(false)

        const result = await requestConfirmation('DROP TABLE table', 'snowflake_execute_sql', mockPluginContext)

        expect(result).toBe(false)
        expect(mockPermissionAsk).toHaveBeenCalled()
      })
    })

    describe('error handling', () => {
      it('should return false on error', async () => {
        mockPermissionAsk.mockRejectedValue(new Error('Permission denied'))

        const result = await requestConfirmation('DROP TABLE table', 'snowflake_execute_sql', mockPluginContext)

        expect(result).toBe(false)
      })

      it('should handle missing permission.ask method', async () => {
        mockPluginContext.client.permission = undefined

        const result = await requestConfirmation('DROP TABLE table', 'snowflake_execute_sql', mockPluginContext)

        expect(result).toBe(false)
      })
    })

    describe('confirmation message formatting', () => {
      it('should format message for DROP TABLE', async () => {
        mockPermissionAsk.mockResolvedValue(true)

        await requestConfirmation('DROP TABLE table_name', 'tool_name', mockPluginContext)

        expect(mockPermissionAsk).toHaveBeenCalledWith({
          tool: 'tool_name',
          action: 'Destructive operation',
          message: expect.stringContaining('DROP TABLE table_name')
          message: expect.stringContaining('modify or destroy data')
        })
      })

      it('should format message for TRUNCATE TABLE', async () => {
        mockPermissionAsk.mockResolvedValue(true)

        await requestConfirmation('TRUNCATE TABLE table_name', 'tool_name', mockPluginContext)

        expect(mockPermissionAsk).toHaveBeenCalledWith({
          tool: 'tool_name',
          action: 'Destructive operation',
          message: expect.stringContaining('TRUNCATE TABLE table_name')
        })
      })

      it('should format message for DELETE FROM', async () => {
        mockPermissionAsk.mockResolvedValue(true)

        await requestConfirmation('DELETE FROM table_name WHERE id = 1', 'tool_name', mockPluginContext)

        expect(mockPermissionAsk).toHaveBeenCalledWith({
          tool: 'tool_name',
          action: 'Destructive operation',
          message: expect.stringContaining('DELETE FROM table_name WHERE id = 1')
        })
      })
    })
  })
})
