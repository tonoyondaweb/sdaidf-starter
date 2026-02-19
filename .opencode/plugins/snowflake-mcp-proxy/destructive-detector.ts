/**
 * Destructive operation detector for Snowflake MCP Proxy Plugin
 * Detects operations that modify or destroy data
 */
import type { PluginContext } from './types'

/**
 * Check if a SQL query is destructive (modifies or destroys data)
 * @param sql - The SQL query string
 * @returns Whether the query is destructive
 */
export function isDestructive(sql: string): boolean {
  const upperSql = sql.toUpperCase()

  const destructivePatterns = [
    /\bDROP\s+(TABLE|VIEW|DATABASE|SCHEMA|WAREHOUSE|ROLE|USER|STAGE|FUNCTION|PROCEDURE)/i,
    /\bTRUNCATE\s+TABLE/i,
    /\bDELETE\s+FROM/i,
    /\bALTER\s+TABLE/i,
    /\bMERGE\s+INTO/i
  ]

  return destructivePatterns.some(pattern => pattern.test(upperSql))
}

/**
 * Request user confirmation for a destructive operation
 * Uses OpenCode's permission.ask mechanism
 * @param sql - The SQL query string
 * @param toolName - The tool name
 * @param ctx - Plugin context
 * @returns Whether user confirmed the operation
 */
export async function requestConfirmation(
  sql: string,
  toolName: string,
  ctx: PluginContext
): Promise<boolean> {
  try {
    const confirmed = await ctx.client.permission.ask({
      tool: toolName,
      action: 'Destructive operation',
      message: `This query will modify or destroy data:\n\n${sql}\n\nConfirm to proceed?`
    })

    return confirmed
  } catch (error) {
    console.error('Error requesting confirmation:', error)
    return false
  }
}
