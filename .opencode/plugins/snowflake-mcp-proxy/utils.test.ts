/**
 * Unit tests for utils.ts
 */
import { describe, it, expect } from 'vitest'
import { extractSqlFromArgs, formatSql, sanitizeForMarkdown, generateSessionId, getTimestamp } from './utils'

describe('Utils', () => {
  describe('extractSqlFromArgs', () => {
    it('should extract SQL from "query" argument', () => {
      const args = { query: 'SELECT * FROM table' }
      const result = extractSqlFromArgs('tool_name', args)
      expect(result).toBe('SELECT * FROM table')
    })

    it('should extract SQL from "sql" argument', () => {
      const args = { sql: 'SELECT * FROM table' }
      const result = extractSqlFromArgs('tool_name', args)
      expect(result).toBe('SELECT * FROM table')
    })

    it('should extract SQL from "statement" argument', () => {
      const args = { statement: 'SELECT * FROM table' }
      const result = extractSqlFromArgs('tool_name', args)
      expect(result).toBe('SELECT * FROM table')
    })

    it('should extract SQL from "command" argument', () => {
      const args = { command: 'SELECT * FROM table' }
      const result = extractSqlFromArgs('tool_name', args)
      expect(result).toBe('SELECT * FROM table')
    })

    it('should return null when no SQL argument found', () => {
      const args = { otherArg: 'value' }
      const result = extractSqlFromArgs('tool_name', args)
      expect(result).toBeNull()
    })

    it('should return null when args is null', () => {
      const result = extractSqlFromArgs('tool_name', null)
      expect(result).toBeNull()
    })

    it('should return null when args is undefined', () => {
      const result = extractSqlFromArgs('tool_name', undefined)
      expect(result).toBeNull()
    })

    it('should handle empty SQL string', () => {
      const args = { query: '' }
      const result = extractSqlFromArgs('tool_name', args)
      expect(result).toBe('')
    })

    it('should handle SQL with only whitespace', () => {
      const args = { query: '   ' }
      const result = extractSqlFromArgs('tool_name', args)
      expect(result).toBe('   ')
    })
  })

  describe('formatSql', () => {
    it('should trim leading whitespace', () => {
      expect(formatSql('   SELECT * FROM table')).toBe('SELECT * FROM table')
    })

    it('should trim trailing whitespace', () => {
      expect(formatSql('SELECT * FROM table   ')).toBe('SELECT * FROM table')
    })

    it('should trim both leading and trailing whitespace', () => {
      expect(formatSql('   SELECT * FROM table   ')).toBe('SELECT * FROM table')
    })

    it('should not modify properly formatted SQL', () => {
      const sql = 'SELECT * FROM table'
      expect(formatSql(sql)).toBe(sql)
    })

    it('should handle empty string', () => {
      expect(formatSql('')).toBe('')
    })

    it('should handle string with only whitespace', () => {
      expect(formatSql('   ')).toBe('')
    })
  })

  describe('sanitizeForMarkdown', () => {
    it('should escape pipe characters', () => {
      expect(sanitizeForMarkdown('a | b')).toBe('a \\| b')
    })

    it('should escape underscore characters', () => {
      expect(sanitizeForMarkdown('a_b')).toBe('a \\_b')
    })

    it('should escape asterisk characters', () => {
      expect(sanitizeForMarkdown('a * b')).toBe('a \\*b')
    })

    it('should escape multiple special characters', () => {
      expect(sanitizeForMarkdown('a | b_c * d')).toBe('a \\| b \\_c \\*d')
    })

    it('should not modify normal text', () => {
      expect(sanitizeForMarkdown('normal text')).toBe('normal text')
    })

    it('should handle empty string', () => {
      expect(sanitizeForMarkdown('')).toBe('')
    })

    it('should handle string with only special characters', () => {
      expect(sanitizeForMarkdown('|_*')).toBe('\\|\\_\\*')
    })
  })

  describe('generateSessionId', () => {
    it('should generate session ID with timestamp', () => {
      const sessionId = generateSessionId()
      expect(sessionId).toMatch(/^session_\d+_[a-z0-9]+$/)
    })

    it('should generate unique session IDs', () => {
      const id1 = generateSessionId()
      const id2 = generateSessionId()
      const id3 = generateSessionId()

      // IDs should be unique (different timestamps or random strings)
      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })

    it('should have consistent prefix', () => {
      const sessionId = generateSessionId()
      expect(sessionId).toStartWith('session_')
    })

    it('should have random suffix after timestamp', () => {
      const sessionId = generateSessionId()
      const parts = sessionId.split('_')
      expect(parts.length).toBe(3)
      expect(parts[0]).toBe('session')
      expect(parts[1]).toMatch(/^\d+$/) // Timestamp
      expect(parts[2]).toMatch(/^[a-z0-9]{7}$/) // 7 char random string
    })
  })

  describe('getTimestamp', () => {
    it('should return ISO 8601 format', () => {
      const timestamp = getTimestamp()
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('should be within valid date range', () => {
      const timestamp = getTimestamp()
      const date = new Date(timestamp)
      const now = new Date()

      // Should be within last few seconds
      expect(date.getTime()).toBeLessThanOrEqual(now.getTime())
      expect(date.getTime()).toBeGreaterThan(now.getTime() - 1000)
    })

    it('should have consistent format across calls', () => {
      const ts1 = getTimestamp()
      const ts2 = getTimestamp()
      
      expect(ts1).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(ts2).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      
      const date1 = new Date(ts1)
      const date2 = new Date(ts2)
      expect(date2.getTime()).toBeGreaterThan(date1.getTime())
    })
  })
})
