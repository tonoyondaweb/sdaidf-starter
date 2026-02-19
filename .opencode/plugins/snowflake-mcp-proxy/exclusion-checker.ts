/**
 * Exclusion checker for Snowflake MCP Proxy Plugin
 * Checks if a query references protected objects using regex patterns
 */
import type { ExclusionCheckResult } from './types'

/**
 * Check if a SQL query references any protected objects
 * @param sql - The SQL query string
 * @param patterns - Array of regex patterns to match against object names
 * @returns ExclusionCheckResult
 */
export function checkExclusions(
  sql: string,
  patterns: string[]
): ExclusionCheckResult {
  const objects = extractObjectReferences(sql)

  for (const obj of objects) {
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i')
        if (regex.test(obj)) {
          return {
            blocked: true,
            reason: `Query blocked: Object '${obj}' matches exclusion pattern '${pattern}'`
          }
        }
      } catch (error) {
        console.error(`Invalid regex pattern: ${pattern}`, error)
      }
    }
  }

  return { blocked: false }
}

/**
 * Extract object references (table/view names) from SQL query
 * @param sql - The SQL query string
 * @returns Array of object references
 */
function extractObjectReferences(sql: string): string[] {
  const objects: Set<string> = new Set()

  // Regex patterns to extract object references
  const patterns = [
    /FROM\s+([^\s,;]+)/gi,
    /JOIN\s+([^\s,;]+)/gi,
    /UPDATE\s+([^\s,;]+)/gi,
    /INSERT\s+INTO\s+([^\s,(;]+)/gi,
    /DELETE\s+FROM\s+([^\s,;]+)/gi,
    /TRUNCATE\s+TABLE\s+([^\s,;]+)/gi,
    /MERGE\s+INTO\s+([^\s,;]+)/gi,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s,(;]+)/gi,
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s,;]+)/gi,
    /ALTER\s+TABLE\s+([^\s,;]+)/gi,
    /DESCRIBE\s+TABLE\s+([^\s,;]+)/gi
  ]

  patterns.forEach(pattern => {
    let match
    while ((match = pattern.exec(sql)) !== null) {
      // Extract object name (may be fully qualified: db.schema.table)
      const objectRef = match[1].trim()
      objects.add(objectRef)
    }
  })

  return Array.from(objects)
}
