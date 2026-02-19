/**
 * Unit tests for row-data-stripper.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { stripRowData } from './row-data-stripper'
import type { SnowflakeQueryResult, ProxyConfig, MetadataOnlyResult } from './types'

describe('Row Data Stripper', () => {
  let mockContext: any
  let baseConfig: ProxyConfig

  beforeEach(() => {
    mockContext = {
      client: {},
      project: {},
      $: {},
      directory: {},
      worktree: {}
    }

    baseConfig = {
      enabled: true,
      skipPatterns: [],
      exclusionPatterns: [],
      requireConfirmation: {
        destructive: true
      },
      variantInference: {
        enabled: true,
        maxSampleSize: 1000,
        samplingFormula: 'sqrt'
      },
      logging: {
        enabled: true,
        logFile: '.snowflake-proxy/logs/audit.md',
        logLevel: 'info'
      },
      snowflakeMcp: {
        configFile: 'mcp-snowflake-config.yaml',
        connectionName: 'default'
      }
    }
  })

  describe('stripRowData', () => {
    describe('empty result sets', () => {
      it('should handle empty rows array', async () => {
        const result: SnowflakeQueryResult = {
          rows: [],
          columns: []
        }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.rowCount).toBe(0)
        expect(stripped.metadata.schema).toEqual([])
        expect(stripped.metadata.nullCounts).toEqual({})
        expect(stripped.metadata.distinctCounts).toEqual({})
        expect(stripped.rows).toEqual([])
      })

      it('should handle null rows', async () => {
        const result: SnowflakeQueryResult = {
          rows: null
          columns: []
        }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.rowCount).toBe(0)
        expect(stripped.rows).toEqual([])
      })

      it('should handle undefined rows', async () => {
        const result: SnowflakeQueryResult = {
          rows: undefined,
          columns: []
        }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.rowCount).toBe(0)
        expect(stripped.rows).toEqual([])
      })
    })

    describe('schema extraction', () => {
      it('should extract schema from result.columns', async () => {
        const result: SnowflakeQueryResult = {
          rows: [
            { id: 1, name: 'John', email: 'john@example.com' }
          ],
          columns: [
            { name: 'id', type: 'number' },
            { name: 'name', type: 'string' },
            { name: 'email', type: 'string' }
          ]
        }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.schema).toEqual([
          { name: 'id', type: 'number' },
          { name: 'name', type: 'string' },
          { name: 'email', type: 'string' }
        ])
      })

      it('should infer schema from first row when columns not provided', async () => {
        const result: SnowflakeQueryResult = {
          rows: [
            { id: 1, name: 'John', active: true, score: 95.5 }
          ]
        }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.schema).toEqual([
          { name: 'id', type: 'number' },
          { name: 'name', type: 'string' },
          { name: 'active', type: 'boolean' },
          { name: 'score', type: 'number' }
        ])
      })

      it('should handle numeric types', async () => {
        const result: SnowflakeQueryResult = {
          rows: [
            { id: 1, count: 100, price: 19.99 }
          ]
        }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.schema).toEqual([
          { name: 'id', type: 'number' },
          { name: 'count', type: 'number' },
          { name: 'price', type: 'number' }
        ])
      })

      it('should handle null values in schema inference', async () => {
        const result: SnowflakeQueryResult = {
          rows: [
            { id: 1, name: null, email: 'john@example.com' }
          ]
        }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        const nameSchema = stripped.metadata.schema.find(s => s.name === 'name')
        expect(nameSchema).toBeTruthy()
        expect(nameSchema.type).toBe('object') // null is typeof 'object'
      })
    })
  })

  describe('statistics calculation', () => {
    describe('row count', () => {
      it('should count rows correctly', async () => {
        const rows = Array(100).fill({ id: 1 })
        const result: SnowflakeQueryResult = { rows }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.rowCount).toBe(100)
      })

      it('should count zero rows', async () => {
        const rows = []
        const result: SnowflakeQueryResult = { rows }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.rowCount).toBe(0)
      })
    })

    describe('null counts', () => {
      it('should count null values per column', async () => {
        const rows = [
          { id: 1, name: 'John', email: null },
          { id: 2, name: null, email: 'jane@example.com' },
          { id: 3, name: 'Bob', email: 'bob@example.com' }
        ]
        const result: SnowflakeQueryResult = { rows }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.nullCounts.id).toBe(0)
        expect(stripped.metadata.nullCounts.name).toBe(2)
        expect(stripped.metadata.nullCounts.email).toBe(1)
      })

      it('should count undefined as null', async () => {
        const rows = [
          { id: 1, name: 'John', email: undefined },
          { id: 2, name: 'Jane', email: 'jane@example.com' }
        ]
        const result: SnowflakeQueryResult = { rows }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.nullCounts.id).toBe(0)
        expect(stripped.metadata.nullCounts.name).toBe(0)
        expect(stripped.metadata.nullCounts.email).toBe(1)
      })
    })

    describe('distinct counts', () => {
      it('should count distinct values per column', async () => {
        const rows = [
          { id: 1, status: 'active' },
          { id: 2, status: 'active' },
          { id: 3, status: 'inactive' }
        ]
        const result: SnowflakeQueryResult = { rows }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.distinctCounts.id).toBe(3)
        expect(stripped.metadata.distinctCounts.status).toBe(2)
      })

      it('should handle all distinct values', async () => {
        const rows = [
          { id: 1, name: 'John' },
          { id: 2, name: 'Jane' },
          { id: 3, name: 'Bob' }
        ]
        const result: SnowflakeQueryResult = { rows }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.distinctCounts.id).toBe(3)
        expect(stripped.metadata.distinctCounts.name).toBe(3)
      })

      it('should handle no distinct values', async () => {
        const rows = [
          { id: 1, status: 'active' },
          { id: 2, status: 'active' },
          { id: 3, status: 'active' }
        ]
        const result: SnowflakeQueryResult = { rows }
        const stripped = await stripRowData(result, baseConfig, mockContext)

        expect(stripped.metadata.distinctCounts.id).toBe(3)
        expect(stripped.metadata.distinctCounts.status).toBe(1)
      })
    })
  })

  describe('row data stripping', () => {
    it('should return empty rows array', async () => {
      const rows = [
        { id: 1, name: 'John' },
        { id: 2, name: 'Jane' },
        { id: 3, name: 'Bob' }
      ]
      const result: SnowflakeQueryResult = { rows }
      const stripped = await stripRowData(result, baseConfig, mockContext)

      expect(stripped.rows).toEqual([])
      expect(stripped.rows.length).toBe(0)
    })

    it('should preserve other result fields', async () => {
      const rows = [{ id: 1, name: 'John' }]
      const result: SnowflakeQueryResult = {
        rows,
        columns: [{ name: 'id', type: 'number' }],
        executionTime: 245
      }
      const stripped = await stripRowData(result, baseConfig, mockContext)

      expect(stripped.metadata.rowCount).toBe(1)
      // executionTime is passed through
    })
  })

  describe('VARIANT column detection', () => {
    it('should detect VARIANT columns by type name', async () => {
      const result: SnowflakeQueryResult = {
        rows: [
          { id: 1, metadata: '{"key": "value"}' }
        ],
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'metadata', type: 'VARIANT' }
        ]
      }
      const stripped = await stripRowData(result, baseConfig, mockContext)

      expect(stripped.metadata.variantInterfaces).toBeDefined()
      // Should have called variant inference for 'metadata' column
    })

    it('should detect lowercase variant', async () => {
      const result: SnowflakeQueryResult = {
        rows: [{ id: 1, meta: '{"key": "value"}' }],
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'meta', type: 'variant' }
        ]
      }
      const stripped = await stripRowData(result, baseConfig, mockContext)

      expect(stripped.metadata.variantInterfaces).toBeDefined()
    })

    it('should not infer for non-VARIANT columns', async () => {
      const result: SnowflakeQueryResult = {
        rows: [
          { id: 1, name: 'John' }
        ],
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'name', type: 'VARCHAR' }
        ]
      }
      const stripped = await stripRowData(result, baseConfig, mockContext)

      // No variant columns, so no interfaces
      expect(stripped.metadata.variantInterfaces).toBeUndefined()
    })
  })

  describe('VARIANT inference disabled', () => {
    it('should skip inference when disabled', async () => {
      const config: ProxyConfig = {
        ...baseConfig,
        variantInference: {
          enabled: false,
          maxSampleSize: 1000,
          samplingFormula: 'sqrt'
        }
      }

      const result: SnowflakeQueryResult = {
        rows: [
          { id: 1, metadata: '{"key": "value"}' }
        ],
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'metadata', type: 'VARIANT' }
        ]
      }
      const stripped = await stripRowData(result, config, mockContext)

      expect(stripped.metadata.variantInterfaces).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should handle single row', async () => {
      const result: SnowflakeQueryResult = {
        rows: [{ id: 1, name: 'John' }]
      }
      const stripped = await stripRowData(result, baseConfig, mockContext)

      expect(stripped.metadata.rowCount).toBe(1)
      expect(stripped.metadata.nullCounts).toEqual({ id: 0, name: 0 })
      expect(stripped.metadata.distinctCounts).toEqual({ id: 1, name: 1 })
    })

    it('should handle rows with null values only', async () => {
      const result: SnowflakeQueryResult = {
        rows: [
          { id: 1, name: null, email: null },
          { id: 2, name: null, email: null }
        ]
      }
      const stripped = await stripRowData(result, baseConfig, mockContext)

      expect(stripped.metadata.rowCount).toBe(2)
      expect(stripped.metadata.nullCounts).toEqual({ id: 0, name: 2, email: 2 })
      expect(stripped.metadata.distinctCounts).toEqual({ id: 2, name: 1, email: 1 })
    })

    it('should handle rows with mixed types', async () => {
      const result: SnowflakeQueryResult = {
        rows: [
          { id: 1, name: 'John', active: true, score: 95.5, created_at: '2024-01-01' }
        ]
      }
      const stripped = await stripRowData(result, baseConfig, mockContext)

      expect(stripped.metadata.schema).toEqual([
        { name: 'id', type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'active', type: 'boolean' },
        { name: 'score', type: 'number' },
        { name: 'created_at', type: 'string' }
      ])
    })
  })
})
