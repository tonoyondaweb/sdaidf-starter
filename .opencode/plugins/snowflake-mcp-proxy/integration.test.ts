/**
 * Integration tests for complete flows
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { classifyQuery, QueryType } from './query-classifier'
import { checkExclusions } from './exclusion-checker'
import { isDestructive, requestConfirmation } from './destructive-detector'

describe('Integration Tests - Complete Flows', () => {
  let mockContext: any

  beforeEach(() => {
    mockContext = {
      client: {
        tool: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'snowflake_execute_sql' },
              { id: 'snowflake_list_tables' },
              { id: 'snowflake_describe_table' },
              { id: 'snowflake_create_table' },
              { id: 'snowflake_drop_table' },
              { id: 'snowflake_alter_table' },
              { id: 'snowflake_insert' },
              { id: 'snowflake_update' },
              { id: 'snowflake_delete' },
              { id: 'snowflake_truncate_table' },
              { id: 'snowflake_merge' }
            ]
          })
        },
        permission: {
          ask: vi.fn().mockResolvedValue(true)
        }
      },
      project: {},
      $: {},
      directory: {},
      worktree: {}
    } as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('DATA query with row data stripping', () => {
    it('should strip row data and return metadata', async () => {
      const { stripRowData } = await import('./row-data-stripper')

      const query = 'SELECT id, name, email FROM customers LIMIT 100'
      expect(classifyQuery(query)).toBe(QueryType.DATA)

      const result = {
        rows: Array(100).fill(null).map((_, i) => ({
          id: i + 1,
          name: `Customer ${i}`,
          email: `customer${i}@example.com`
        })),
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'name', type: 'VARCHAR' },
          { name: 'email', type: 'VARCHAR' }
        ]
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: false, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      expect(stripped.metadata.rowCount).toBe(100)
      expect(stripped.rows).toEqual([])
      expect(stripped.metadata.schema).toHaveLength(3)
      expect(stripped.metadata.nullCounts).toBeDefined()
      expect(stripped.metadata.distinctCounts).toBeDefined()
    })
  })

  describe('DATA query with VARIANT column', () => {
    it('should infer TypeScript interface from VARIANT column', async () => {
      const { stripRowData } = await import('./row-data-stripper')

      const query = 'SELECT id, metadata FROM events LIMIT 100'
      expect(classifyQuery(query)).toBe(QueryType.DATA)

      const variantData = JSON.stringify({ event_id: 12345, source: 'api', timestamp: '2024-01-01T00:00:00Z' })
      const result = {
        rows: Array(100).fill({ id: 1, metadata: variantData }),
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'metadata', type: 'VARIANT' }
        ]
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: true, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      expect(stripped.metadata.rowCount).toBe(100)
      expect(stripped.metadata.variantInterfaces).toBeDefined()
      expect(stripped.metadata.variantInterfaces!.metadata).toContain('interface')
      expect(stripped.metadata.variantInterfaces!.metadata).toContain('event_id')
      expect(stripped.metadata.variantInterfaces!.metadata).toContain('source')
    })
  })

  describe('Blocked query - exclusion pattern', () => {
    it('should block query referencing PROD object', async () => {
      const sql = 'SELECT * FROM PROD.orders'
      expect(classifyQuery(sql)).toBe(QueryType.DATA)

      const patterns = ['PROD\\..*']
      const result = checkExclusions(sql, patterns)

      expect(result.blocked).toBe(true)
      expect(result.reason).toContain('PROD.orders')
      expect(result.reason).toContain('exclusion pattern')
    })

    it('should block query ending with _PROD', async () => {
      const sql = 'SELECT * FROM analytics.orders_PROD'
      expect(classifyQuery(sql)).toBe(QueryType.DATA)

      const patterns = ['.*_PROD']
      const result = checkExclusions(sql, patterns)

      expect(result.blocked).toBe(true)
      expect(result.reason).toContain('orders_PROD')
    })
  })

  describe('METADATA query pass-through', () => {
    it('should pass through CREATE TABLE query', async () => {
      const { stripRowData } = await import('./row-data-stripper')

      const sql = 'CREATE TABLE customers (id NUMBER, name VARCHAR)'
      expect(classifyQuery(sql)).toBe(QueryType.METADATA)

      const result = {
        rows: [],
        columns: []
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: false, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      expect(stripped.metadata.rowCount).toBe(0)
      // Metadata queries pass through unchanged
    })

    it('should pass through DROP TABLE query', async () => {
      const { stripRowData } = await import('./row-data-stripper')

      const sql = 'DROP TABLE temp_table'
      expect(classifyQuery(sql)).toBe(QueryType.METADATA)

      const result = {
        rows: [],
        columns: [],
        executionTime: 50
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: false, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      expect(stripped.metadata.rowCount).toBe(0)
    })
  })

  describe('Destructive operation confirmation', () => {
    it('should request confirmation for DROP TABLE', async () => {
      const sql = 'DROP TABLE analytics.temp_table'
      expect(isDestructive(sql)).toBe(true)

      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_drop_table',
        mockContext
      )

      expect(confirmed).toBe(true)
      expect(mockContext.client.permission.ask).toHaveBeenCalledWith({
        tool: 'snowflake_drop_table',
        action: 'Destructive operation',
        message: expect.stringContaining('DROP TABLE analytics.temp_table')
      })
    })

    it('should request confirmation for TRUNCATE TABLE', async () => {
      const sql = 'TRUNCATE TABLE analytics.orders'
      expect(isDestructive(sql)).toBe(true)

      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_truncate_table',
        mockContext
      )

      expect(confirmed).toBe(true)
      expect(mockContext.client.permission.ask).toHaveBeenCalled()
    })

    it('should request confirmation for DELETE FROM', async () => {
      const sql = 'DELETE FROM analytics.orders WHERE created_at < "2024-01-01"'
      expect(isDestructive(sql)).toBe(true)

      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_delete',
        mockContext
      )

      expect(confirmed).toBe(true)
      expect(mockContext.client.permission.ask).toHaveBeenCalled()
    })

    it('should not request confirmation for SELECT', async () => {
      const sql = 'SELECT * FROM analytics.orders'
      expect(isDestructive(sql)).toBe(false)
    })

    it('should not request confirmation for INSERT', async () => {
      const sql = 'INSERT INTO analytics.orders VALUES (1, "John")'
      expect(isDestructive(sql)).toBe(false)
    })

    it('should not request confirmation for UPDATE', async () => {
      const sql = 'UPDATE analytics.orders SET status = "archived" WHERE id = 1'
      expect(isDestructive(sql)).toBe(false)
    })
  })

  describe('Tool discovery and filtering', () => {
    it('should discover Snowflake tools and filter cortex_*', async () => {
      const { discoverSnowflakeTools, shouldIntercept } = await import('./tool-discovery')

      const tools = await discoverSnowflakeTools.discoverSnowflakeTools(mockContext.client)

      expect(mockContext.client.tool.list).toHaveBeenCalledWith({
        query: {
          provider: 'snowflake',
          model: '*'
        }
      })

      expect(tools).toContain('snowflake_execute_sql')
      expect(tools).toContain('snowflake_list_tables')
      expect(tools).toContain('snowflake_create_table')
      expect(tools).toContain('snowflake_drop_table')

      expect(tools).not.toContain('cortex_analyst')
      expect(tools).not.toContain('cortex_search')
    })

    it('should intercept snowflake_* tools', async () => {
      const tools = [
        'snowflake_execute_sql',
        'snowflake_list_tables',
        'cortex_analyst'  // Should be skipped
      ]

      const skipPatterns = ['cortex_*']

      expect(shouldIntercept('snowflake_execute_sql', tools, skipPatterns)).toBe(true)
      expect(shouldIntercept('snowflake_list_tables', tools, skipPatterns)).toBe(true)
      expect(shouldIntercept('cortex_analyst', tools, skipPatterns)).toBe(false)
    })
  })

  describe('Complete flow - DATA query to metadata', () => {
    it('should flow from SQL query to metadata-only result', async () => {
      const { stripRowData } = await import('./row-data-stripper')
      const { checkExclusions } = await import('./exclusion-checker')

      const sql = 'SELECT id, name, total FROM orders LIMIT 100'
      const patterns = []

      // Step 1: Classify query
      expect(classifyQuery(sql)).toBe(QueryType.DATA)

      // Step 2: Check exclusions
      const exclusionResult = checkExclusions(sql, patterns)
      expect(exclusionResult.blocked).toBe(false)

      // Step 3: Strip row data
      const result = {
        rows: Array(100).fill(null).map((_, i) => ({
          id: i + 1,
          name: `Order ${i}`,
          total: Math.random() * 100
        })),
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'name', type: 'VARCHAR' },
          { name: 'total', type: 'NUMBER' }
        ]
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: false, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      // Verify metadata-only result
      expect(stripped.metadata.rowCount).toBe(100)
      expect(stripped.rows).toEqual([])
      expect(stripped.metadata.schema).toHaveLength(3)
      expect(stripped.metadata.nullCounts).toBeDefined()
      expect(stripped.metadata.distinctCounts).toBeDefined()
    })
  })

  describe('Complete flow - Blocked query', () => {
    it('should block query before execution', async () => {
      const sql = 'SELECT * FROM PROD.payments'
      const patterns = ['PROD\\..*']

      // Step 1: Classify query
      expect(classifyQuery(sql)).toBe(QueryType.DATA)

      // Step 2: Check exclusions
      const exclusionResult = checkExclusions(sql, patterns)

      // Verify blocking
      expect(exclusionResult.blocked).toBe(true)
      expect(exclusionResult.reason).toContain('PROD.payments')
      expect(exclusionResult.reason).toContain('blocked')
    })
  })

  describe('Complete flow - Destructive operation with confirmation', () => {
    it('should request confirmation then allow', async () => {
      const sql = 'DROP TABLE analytics.temp_table'

      // Step 1: Classify query
      expect(classifyQuery(sql)).toBe(QueryType.METADATA)

      // Step 2: Check if destructive
      expect(isDestructive(sql)).toBe(true)

      // Step 3: Request confirmation (user confirms)
      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_drop_table',
        mockContext
      )

      expect(confirmed).toBe(true)
      expect(mockContext.client.permission.ask).toHaveBeenCalled()
    })

    it('should request confirmation then block on denial', async () => {
      const sql = 'DROP TABLE analytics.temp_table'

      // Mock user denial
      mockContext.client.permission.ask.mockResolvedValue(false)

      // Request confirmation (user denies)
      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_drop_table',
        mockContext
      )

      expect(confirmed).toBe(false)
      expect(mockContext.client.permission.ask).toHaveBeenCalled()
    })
  })

  describe('Edge case handling', () => {
    it('should handle empty query in classification', () => {
      expect(classifyQuery('')).toBe(QueryType.METADATA)
    })

    it('should handle query with only whitespace', () => {
      expect(classifyQuery('   ')).toBe(QueryType.METADATA)
    })

    it('should handle exclusion patterns as empty array', () => {
      const sql = 'SELECT * FROM any_table'
      const patterns: string[] = []

      const result = checkExclusions(sql, patterns)
      expect(result.blocked).toBe(false)
    })

    it('should handle invalid regex patterns gracefully', () => {
      const sql = 'SELECT * FROM table'
      const patterns = ['PROD\\..*', '[invalid(regex']

      // Should not throw error
      const result = checkExclusions(sql, patterns)
      expect(result.blocked).toBe(true) // First valid pattern matches
    })
  })
})
        },
        permission: {
          ask: vi.fn().mockResolvedValue(true)
        }
      },
      project: {},
      $: {},
      directory: {},
      worktree: {}
    } as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('DATA query with row data stripping', () => {
    it('should strip row data and return metadata', async () => {
      const { stripRowData } = await import('./row-data-stripper')
      const { QueryType } = await import('./query-classifier')

      const query = 'SELECT id, name, email FROM customers LIMIT 100'
      expect(QueryType.classifyQuery(query)).toBe(QueryType.DATA)

      const result = {
        rows: Array(100).fill(null).map((_, i) => ({
          id: i + 1,
          name: `Customer ${i}`,
          email: `customer${i}@example.com`
        })),
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'name', type: 'VARCHAR' },
          { name: 'email', type: 'VARCHAR' }
        ]
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: false, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      expect(stripped.metadata.rowCount).toBe(100)
      expect(stripped.rows).toEqual([])
      expect(stripped.metadata.schema).toHaveLength(3)
      expect(stripped.metadata.nullCounts).toBeDefined()
      expect(stripped.metadata.distinctCounts).toBeDefined()
    })
  })

  describe('DATA query with VARIANT column', () => {
    it('should infer TypeScript interface from VARIANT column', async () => {
      const { stripRowData } = await import('./row-data-stripper')
      const { QueryType } = await import('./query-classifier')

      const query = 'SELECT id, metadata FROM events LIMIT 100'
      expect(QueryType.classifyQuery(query)).toBe(QueryType.DATA)

      const variantData = JSON.stringify({ event_id: 12345, source: 'api', timestamp: '2024-01-01T00:00:00Z' })
      const result = {
        rows: Array(100).fill({ id: 1, metadata: variantData }),
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'metadata', type: 'VARIANT' }
        ]
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: true, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      expect(stripped.metadata.rowCount).toBe(100)
      expect(stripped.metadata.variantInterfaces).toBeDefined()
      expect(stripped.metadata.variantInterfaces!.metadata).toContain('interface')
      expect(stripped.metadata.variantInterfaces!.metadata).toContain('event_id')
      expect(stripped.metadata.variantInterfaces!.metadata).toContain('source')
    })
  })

  describe('Blocked query - exclusion pattern', () => {
    it('should block query referencing PROD object', async () => {
      const { checkExclusions } = await import('./exclusion-checker')
      const { classifyQuery } = await import('./query-classifier')

      const sql = 'SELECT * FROM PROD.orders'
      expect(classifyQuery.classifyQuery(sql)).toBe(classifyQuery.QueryType.DATA)

      const patterns = ['PROD\\..*']
      const result = checkExclusions.checkExclusions(sql, patterns)

      expect(result.blocked).toBe(true)
      expect(result.reason).toContain('PROD.orders')
      expect(result.reason).toContain('exclusion pattern')
    })

    it('should block query ending with _PROD', async () => {
      const { checkExclusions } = await import('./exclusion-checker')
      const { classifyQuery } = await import('./query-classifier')

      const sql = 'SELECT * FROM analytics.orders_PROD'
      expect(classifyQuery.classifyQuery(sql)).toBe(classifyQuery.QueryType.DATA)

      const patterns = ['.*_PROD']
      const result = checkExclusions.checkExclusions(sql, patterns)

      expect(result.blocked).toBe(true)
      expect(result.reason).toContain('orders_PROD')
    })
  })

  describe('METADATA query pass-through', () => {
    it('should pass through CREATE TABLE query', async () => {
      const { stripRowData } = await import('./row-data-stripper')
      const { QueryType } = await import('./query-classifier')

      const sql = 'CREATE TABLE customers (id NUMBER, name VARCHAR)'
      expect(QueryType.classifyQuery(sql)).toBe(QueryType.METADATA)

      const result = {
        rows: [],
        columns: []
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: false, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      expect(stripped.metadata.rowCount).toBe(0)
      // Metadata queries pass through unchanged
    })

    it('should pass through DROP TABLE query', async () => {
      const { stripRowData } = await import('./row-data-stripper')
      const { QueryType } = await import('./query-classifier')

      const sql = 'DROP TABLE temp_table'
      expect(QueryType.classifyQuery(sql)).toBe(QueryType.METADATA)

      const result = {
        rows: [],
        columns: [],
        executionTime: 50
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: false, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      expect(stripped.metadata.rowCount).toBe(0)
    })
  })

  describe('Destructive operation confirmation', () => {
    it('should request confirmation for DROP TABLE', async () => {
      const { isDestructive, requestConfirmation } = await import('./destructive-detector')
      const { classifyQuery } = await import('./query-classifier')

      const sql = 'DROP TABLE analytics.temp_table'
      expect(classifyQuery.classifyQuery(sql)).toBe(classifyQuery.QueryType.METADATA)
      expect(isDestructive.isDestructive(sql)).toBe(true)

      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_drop_table',
        mockContext
      )

      expect(confirmed).toBe(true)
      expect(mockContext.client.permission.ask).toHaveBeenCalledWith({
        tool: 'snowflake_drop_table',
        action: 'Destructive operation',
        message: expect.stringContaining('DROP TABLE analytics.temp_table')
      })
    })

    it('should request confirmation for TRUNCATE TABLE', async () => {
      const { isDestructive, requestConfirmation } = await import('./destructive-detector')

      const sql = 'TRUNCATE TABLE analytics.orders'
      expect(isDestructive.isDestructive(sql)).toBe(true)

      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_truncate_table',
        mockContext
      )

      expect(confirmed).toBe(true)
      expect(mockContext.client.permission.ask).toHaveBeenCalled()
    })

    it('should request confirmation for DELETE FROM', async () => {
      const { isDestructive, requestConfirmation } = await import('./destructive-detector')

      const sql = 'DELETE FROM analytics.orders WHERE created_at < "2024-01-01"'
      expect(isDestructive.isDestructive(sql)).toBe(true)

      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_delete',
        mockContext
      )

      expect(confirmed).toBe(true)
      expect(mockContext.client.permission.ask).toHaveBeenCalled()
    })

    it('should not request confirmation for SELECT', async () => {
      const { isDestructive } = await import('./destructive-detector')

      const sql = 'SELECT * FROM analytics.orders'
      expect(isDestructive.isDestructive(sql)).toBe(false)
    })

    it('should not request confirmation for INSERT', async () => {
      const { isDestructive } = await import('./destructive-detector')

      const sql = 'INSERT INTO analytics.orders VALUES (1, "John")'
      expect(isDestructive.isDestructive(sql)).toBe(false)
    })

    it('should not request confirmation for UPDATE', async () => {
      const { isDestructive } = await import('./destructive-detector')

      const sql = 'UPDATE analytics.orders SET status = "archived" WHERE id = 1'
      expect(isDestructive.isDestructive(sql)).toBe(false)
    })
  })

  describe('Tool discovery and filtering', () => {
    it('should discover Snowflake tools and filter cortex_*', async () => {
      const { discoverSnowflakeTools, shouldIntercept } = await import('./tool-discovery')

      const tools = await discoverSnowflakeTools.discoverSnowflakeTools(mockContext.client)

      expect(mockContext.client.tool.list).toHaveBeenCalledWith({
        query: {
          provider: 'snowflake',
          model: '*'
        }
      })

      expect(tools).toContain('snowflake_execute_sql')
      expect(tools).toContain('snowflake_list_tables')
      expect(tools).toContain('snowflake_create_table')
      expect(tools).toContain('snowflake_drop_table')

      expect(tools).not.toContain('cortex_analyst')
      expect(tools).not.toContain('cortex_search')
    })

    it('should intercept snowflake_* tools', async () => {
      const { shouldIntercept } = await import('./tool-discovery')

      const tools = [
        'snowflake_execute_sql',
        'snowflake_list_tables',
        'cortex_analyst'  // Should be skipped
      ]

      const skipPatterns = ['cortex_*']

      expect(shouldIntercept('snowflake_execute_sql', tools, skipPatterns)).toBe(true)
      expect(shouldIntercept('snowflake_list_tables', tools, skipPatterns)).toBe(true)
      expect(shouldIntercept('cortex_analyst', tools, skipPatterns)).toBe(false)
    })
  })

  describe('Complete flow - DATA query to metadata', () => {
    it('should flow from SQL query to metadata-only result', async () => {
      const { classifyQuery } = await import('./query-classifier')
      const { stripRowData } = await import('./row-data-stripper')
      const { checkExclusions } = await import('./exclusion-checker')

      const sql = 'SELECT id, name, total FROM orders LIMIT 100'
      const patterns = []

      // Step 1: Classify query
      expect(classifyQuery.classifyQuery(sql)).toBe(classifyQuery.QueryType.DATA)

      // Step 2: Check exclusions
      const exclusionResult = checkExclusions.checkExclusions(sql, patterns)
      expect(exclusionResult.blocked).toBe(false)

      // Step 3: Strip row data
      const result = {
        rows: Array(100).fill(null).map((_, i) => ({
          id: i + 1,
          name: `Order ${i}`,
          total: Math.random() * 100
        })),
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'name', type: 'VARCHAR' },
          { name: 'total', type: 'NUMBER' }
        ]
      }

      const stripped = await stripRowData.default(result, {
        variantInference: { enabled: false, maxSampleSize: 1000, samplingFormula: 'sqrt' }
      }, mockContext)

      // Verify metadata-only result
      expect(stripped.metadata.rowCount).toBe(100)
      expect(stripped.rows).toEqual([])
      expect(stripped.metadata.schema).toHaveLength(3)
      expect(stripped.metadata.nullCounts).toBeDefined()
      expect(stripped.metadata.distinctCounts).toBeDefined()
    })
  })

  describe('Complete flow - Blocked query', () => {
    it('should block query before execution', async () => {
      const { classifyQuery } = await import('./query-classifier')
      const { checkExclusions } = await import('./exclusion-checker')

      const sql = 'SELECT * FROM PROD.payments'
      const patterns = ['PROD\\..*']

      // Step 1: Classify query
      expect(classifyQuery.classifyQuery(sql)).toBe(classifyQuery.QueryType.DATA)

      // Step 2: Check exclusions
      const exclusionResult = checkExclusions.checkExclusions(sql, patterns)

      // Verify blocking
      expect(exclusionResult.blocked).toBe(true)
      expect(exclusionResult.reason).toContain('PROD.payments')
      expect(exclusionResult.reason).toContain('blocked')
    })
  })

  describe('Complete flow - Destructive operation with confirmation', () => {
    it('should request confirmation then allow', async () => {
      const { classifyQuery } = await import('./query-classifier')
      const { isDestructive, requestConfirmation } = await import('./destructive-detector')

      const sql = 'DROP TABLE analytics.temp_table'

      // Step 1: Classify query
      expect(classifyQuery.classifyQuery(sql)).toBe(classifyQuery.QueryType.METADATA)

      // Step 2: Check if destructive
      expect(isDestructive.isDestructive(sql)).toBe(true)

      // Step 3: Request confirmation (user confirms)
      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_drop_table',
        mockContext
      )

      expect(confirmed).toBe(true)
      expect(mockContext.client.permission.ask).toHaveBeenCalled()
    })

    it('should request confirmation then block on denial', async () => {
      const { isDestructive, requestConfirmation } = await import('./destructive-detector')

      const sql = 'DROP TABLE analytics.temp_table'

      // Mock user denial
      mockContext.client.permission.ask.mockResolvedValue(false)

      // Request confirmation (user denies)
      const confirmed = await requestConfirmation.requestConfirmation(
        sql,
        'snowflake_drop_table',
        mockContext
      )

      expect(confirmed).toBe(false)
      expect(mockContext.client.permission.ask).toHaveBeenCalled()
    })
  })

  describe('Edge case handling', () => {
    it('should handle empty query in classification', async () => {
      const { classifyQuery } = await import('./query-classifier')

      expect(classifyQuery.classifyQuery('')).toBe(classifyQuery.QueryType.METADATA)
    })

    it('should handle query with only whitespace', async () => {
      const { classifyQuery } = await import('./query-classifier')

      expect(classifyQuery.classifyQuery('   ')).toBe(classifyQuery.QueryType.METADATA)
    })

    it('should handle exclusion patterns as empty array', async () => {
      const { checkExclusions } = await import('./exclusion-checker')

      const sql = 'SELECT * FROM any_table'
      const patterns: string[] = []

      const result = checkExclusions.checkExclusions(sql, patterns)
      expect(result.blocked).toBe(false)
    })

    it('should handle invalid regex patterns gracefully', async () => {
      const { checkExclusions } = await import('./exclusion-checker')

      const sql = 'SELECT * FROM table'
      const patterns = ['PROD\\..*', '[invalid(regex']

      // Should not throw error
      const result = checkExclusions.checkExclusions(sql, patterns)
      expect(result.blocked).toBe(true) // First valid pattern matches
    })
  })
})
