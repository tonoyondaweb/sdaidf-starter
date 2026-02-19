/**
 * Query classifier for Snowflake MCP Proxy Plugin
 * Classifies SQL queries into DATA vs METADATA
 */

/**
 * Query type enumeration
 */
export enum QueryType {
  DATA,      // SELECT queries - ALL variants (including scalar)
  METADATA   // DDL, DML, SHOW, DESCRIBE, etc.
}

/**
 * Classify a SQL query as DATA or METADATA
 * @param sql - The SQL query string
 * @returns QueryType
 */
export function classifyQuery(sql: string): QueryType {
  const firstWord = extractFirstKeyword(sql).toUpperCase()

  // ALL SELECT queries are DATA queries (must be intercepted)
  if (firstWord === 'SELECT') {
    return QueryType.DATA
  }

  // Everything else is metadata
  return QueryType.METADATA
}

/**
 * Extract the first keyword from SQL query
 * @param sql - The SQL query string
 * @returns The first keyword
 */
function extractFirstKeyword(sql: string): string {
  const trimmed = sql.trim()
  const match = trimmed.match(/^(\w+)/)
  return match ? match[1] : ''
}
