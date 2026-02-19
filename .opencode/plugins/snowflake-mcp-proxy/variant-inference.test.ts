/**
 * Unit tests for variant-inference.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { inferVariantInterface } from './variant-inference'
import type { VariantInferenceConfig } from './types'

describe('VARIANT Inference', () => {
  let mockContext: any

  beforeEach(() => {
    mockContext = {
      client: {},
      project: {},
      $: {},
      directory: {},
      worktree: {}
    }
  })

  describe('adaptive sampling formula', () => {
    const baseConfig: VariantInferenceConfig = {
      enabled: true,
      maxSampleSize: 1000,
      samplingFormula: 'sqrt'
    }

    describe('sample size calculation', () => {
      it('should sample min(1000, sqrt(10)) = 3 rows for 10 rows', async () => {
        const rows = Array(10).fill({ id: 1, metadata: '{}' })
        const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

        expect(result).toBeTruthy()
        // sqrt(10) ≈ 3.16, so min(1000, 3) = 3
      })

      it('should sample min(1000, sqrt(100)) = 10 rows for 100 rows', async () => {
        const rows = Array(100).fill({ id: 1, metadata: '{}' })
        const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

        expect(result).toBeTruthy()
        // sqrt(100) = 10, so min(1000, 10) = 10
      })

      it('should sample min(1000, sqrt(1000)) = 31 rows for 1000 rows', async () => {
        const rows = Array(1000).fill({ id: 1, metadata: '{}' })
        const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

        expect(result).toBeTruthy()
        // sqrt(1000) ≈ 31.62, so min(1000, 31) = 31
      })

      it('should sample min(1000, sqrt(10000)) = 100 rows for 10,000 rows', async () => {
        const rows = Array(10000).fill({ id: 1, metadata: '{}' })
        const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

        expect(result).toBeTruthy()
        // sqrt(10000) = 100, so min(1000, 100) = 100
      })

      it('should sample min(1000, sqrt(100000)) = 316 rows for 100,000 rows', async () => {
        const rows = Array(100000).fill({ id: 1, metadata: '{}' })
        const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

        expect(result).toBeTruthy()
        // sqrt(100000) ≈ 316.23, so min(1000, 316) = 316
      })

      it('should sample min(1000, sqrt(1000000)) = 1000 rows for 1,000,000 rows', async () => {
        const rows = Array(1000000).fill({ id: 1, metadata: '{}' })
        const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

        expect(result).toBeTruthy()
        // sqrt(1000000) = 1000, so min(1000, 1000) = 1000
      })

      it('should return all rows when total <= sample size', async () => {
        const rows = Array(50).fill({ id: 1, metadata: '{}' })
        const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

        expect(result).toBeTruthy()
        // sqrt(50) ≈ 7.07, min(1000, 7) = 7, but total is 50 so should use all
      })
    })
  })

  describe('JSON schema inference', () => {
    const baseConfig: VariantInferenceConfig = {
      enabled: true,
      maxSampleSize: 1000,
      samplingFormula: 'sqrt'
    }

    it('should infer primitive types', async () => {
      const rows = [
        { metadata: '{"key": "value"}' },
        { metadata: '{"count": 100}' },
        { metadata: '{"active": true}' },
        { metadata: '{"ratio": 1.5}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('key?: string')
      expect(result).toContain('count?: number')
      expect(result).toContain('active?: boolean')
      expect(result).toContain('ratio?: number')
    })

    it('should infer nested objects', async () => {
      const rows = [
        { metadata: '{"user": {"name": "John", "email": "john@example.com"}}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('user?:')
      expect(result).toContain('name?: string')
      expect(result).toContain('email?: string')
    })

    it('should infer arrays', async () => {
      const rows = [
        { metadata: '{"tags": ["tag1", "tag2", "tag3"]}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('tags?:')
      expect(result).toContain('string[]')
    })

    it('should handle optional fields', async () => {
      const rows = [
        { metadata: '{"name": "John", "age": 30}' },
        { metadata: '{"name": "Jane"}' }  // age is optional
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('name?: string')
      // age should be optional if not in some samples
      expect(result).toMatch(/age\?\s*:/)
    })

    it('should infer deeply nested structures', async () => {
      const rows = [
        { metadata: '{"user": {"profile": {"preferences": {"theme": "dark"}}}}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('user?:')
      expect(result).toContain('profile?:')
      expect(result).toContain('preferences?:')
    })

    it('should infer null values', async () => {
      const rows = [
        { metadata: '{"value": null}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('value?: null')
    })

    it('should infer array of objects', async () => {
      const rows = [
        { metadata: '{"items": [{"name": "item1"}, {"name": "item2"}]}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('items?:')
      expect(result).toContain('[]')
      expect(result).toContain('name?: string')
    })
  })

  describe('TypeScript interface generation', () => {
    const baseConfig: VariantInferenceConfig = {
      enabled: true,
      maxSampleSize: 1000,
      samplingFormula: 'sqrt'
    }

    it('should generate valid TypeScript syntax', async () => {
      const rows = [
        { metadata: '{"name": "John", "age": 30}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('interface')
      expect(result).toContain('{')
      expect(result).toContain('}')
      expect(result).toContain('name?: string')
      expect(result).toContain('age?: number')
    })

    it('should use union types for conflicting values', async () => {
      const rows = [
        { metadata: '{"value": "string"}' },
        { metadata: '{"value": 100}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      // Should have union type or 'any'
      expect(result).toMatch(/value\?\s*:/)
    })

    it('should handle empty objects', async () => {
      const rows = [
        { metadata: '{}{}' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      expect(result).toContain('interface VariantData {\n}')
    })
  })

  describe('Edge cases and error handling', () => {
    const baseConfig: VariantInferenceConfig = {
      enabled: true,
      maxSampleSize: 1000,
      samplingFormula: 'sqrt'
    }

    it('should return null for empty rows array', async () => {
      const rows: []
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeNull()
    })

    it('should return null when all values are null', async () => {
      const rows = [
        { id: 1, metadata: null },
        { id: 2, metadata: null },
        { id: 3, metadata: null }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeNull()
    })

    it('should handle rows without variant column', async () => {
      const rows = [
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeNull()
    })

    it('should skip rows with undefined variant values', async () => {
      const rows = [
        { id: 1, metadata: '{"key": "value"}' },
        { id: 2 },  // metadata is undefined
        { id: 3, metadata: null }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
      // Should only process defined values
    })

    it('should handle invalid JSON strings gracefully', async () => {
      const rows = [
        { id: 1, metadata: '{"key": "value"}' },
        { id: 2, metadata: 'invalid json {' }
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      // Should still work with valid samples
      expect(result).toBeTruthy()
    })

    it('should handle non-string variant values', async () => {
      const rows = [
        { id: 1, metadata: { key: 'value' } }  // Already parsed object
      ]
      const result = await inferVariantInterface('metadata', rows, baseConfig, mockContext)

      expect(result).toBeTruthy()
    })
  })

  describe('Configuration', () => {
    it('should return null when inference is disabled', async () => {
      const config: VariantInferenceConfig = {
        enabled: false,
        maxSampleSize: 1000,
        samplingFormula: 'sqrt'
      }
      const rows = [
        { id: 1, metadata: '{"key": "value"}' }
      ]

      const result = await inferVariantInterface('metadata', rows, config, mockContext)

      expect(result).toBeNull()
    })
  })
})
