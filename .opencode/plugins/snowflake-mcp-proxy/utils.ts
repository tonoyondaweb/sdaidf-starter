/**
 * Utility functions for Snowflake MCP Proxy Plugin
 */

/**
 * Extract SQL query from tool arguments
 * Different tools may pass SQL in different argument names
 */
export function extractSqlFromArgs(toolName: string, args: any): string | null {
  // Different tools may pass SQL in different argument names
  const sqlArgs = ['query', 'sql', 'statement', 'command']

  for (const arg of sqlArgs) {
    if (args && args[arg] && typeof args[arg] === 'string') {
      return args[arg]
    }
  }

  return null
}

/**
 * Format SQL for display (basic)
 */
export function formatSql(sql: string): string {
  return sql.trim()
}

/**
 * Sanitize text for Markdown output
 * Escape special Markdown characters
 */
export function sanitizeForMarkdown(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Get current timestamp in ISO format
 */
export function getTimestamp(): string {
  return new Date().toISOString()
}
