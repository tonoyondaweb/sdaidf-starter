/**
 * Snowflake MCP Proxy Plugin - Main Entry Point
 *
 * This plugin intercepts Snowflake MCP tool calls, strips row data from responses,
 * enforces safety guards, and ensures no production data is exposed to AI agents.
 */
import type { Plugin } from '@opencode-ai/plugin'
import { loadProxyConfig, type ProxyConfig } from './config-loader'
import { AuditLogger, initializeAuditLogFile } from './audit-logger'
import { discoverSnowflakeTools, shouldIntercept } from './tool-discovery'
import { classifyQuery, QueryType } from './query-classifier'
import { checkExclusions } from './exclusion-checker'
import { isDestructive, requestConfirmation } from './destructive-detector'
import { stripRowData } from './row-data-stripper'
import { extractSqlFromArgs, generateSessionId } from './utils'
import type { AuditEntry, BeforeToolResult, MetadataOnlyResult } from './types'

/**
 * Snowflake MCP Proxy Plugin
 *
 * @param ctx - Plugin context provided by OpenCode
 * @returns Plugin hooks configuration
 */
export const SnowflakeMCPProxyPlugin: Plugin = async (ctx) => {
  // Load configuration
  const config = await loadProxyConfig()
  if (!config.enabled) {
    console.log('Snowflake MCP Proxy is disabled in configuration')
    return {}
  }

  console.log('Initializing Snowflake MCP Proxy Plugin...')

  // Initialize audit logger
  await initializeAuditLogFile(config.logging.logFile)
  const logger = new AuditLogger(config.logging)

  // Discover Snowflake MCP tools
  const snowflakeTools = await discoverSnowflakeTools(ctx.client)
  console.log(`Proxy configured to intercept ${snowflakeTools.length} Snowflake tools`)

  // Generate session ID
  const sessionId = generateSessionId()

  return {
    'tool.execute.before': async (input: any, output: any) => {
      // Skip non-Snowflake tools
      if (!shouldIntercept(input.tool, snowflakeTools, config.skipPatterns)) {
        return
      }

      // Extract SQL query from arguments (if present)
      const sql = extractSqlFromArgs(input.tool, output.args)

      const beforeResult = await beforeToolHandler(
        input.tool,
        sql,
        output.args,
        config,
        logger,
        sessionId,
        ctx
      )

      // Block execution if needed
      if (beforeResult.blocked) {
        throw new Error(beforeResult.reason)
      }

      // Modify arguments if needed
      if (beforeResult.modifiedArgs) {
        output.args = beforeResult.modifiedArgs
      }
    },

    'tool.execute.after': async (input: any, output: any) => {
      if (!shouldIntercept(input.tool, snowflakeTools, config.skipPatterns)) {
        return
      }

      const modifiedOutput = await afterToolHandler(
        input.tool,
        input.args,
        output.output,
        config,
        logger,
        sessionId
      )

      // Replace output with metadata-only version
      output.output = modifiedOutput
    }
  }
}

/**
 * Handle tool execution before hook
 * @param toolName - Name of the tool being called
 * @param sql - SQL query string (if applicable)
 * @param args - Tool arguments
 * @param config - Proxy configuration
 * @param logger - Audit logger instance
 * @param sessionId - Current session ID
 * @param ctx - Plugin context
 * @returns Before-tool handler result
 */
async function beforeToolHandler(
  toolName: string,
  sql: string | null,
  args: any,
  config: ProxyConfig,
  logger: AuditLogger,
  sessionId: string,
  ctx: any
): Promise<BeforeToolResult> {
  const result: BeforeToolResult = {
    blocked: false,
    reason: undefined,
    modifiedArgs: undefined
  }

  const queryType = sql ? classifyQuery(sql) : 'METADATA' as QueryType
  const destructive = sql ? isDestructive(sql) : false
  const confirmationRequired = destructive && config.requireConfirmation.destructive

  // Check exclusion patterns for SQL queries
  if (sql && config.exclusionPatterns.length > 0) {
    const exclusionCheck = checkExclusions(sql, config.exclusionPatterns)
    if (exclusionCheck.blocked) {
      result.blocked = true
      result.reason = exclusionCheck.reason

      // Log blocked request
      await logger.log({
        sessionId,
        requestNumber: 0,
        toolName,
        sql,
        queryType,
        status: 'blocked',
        exclusions: config.exclusionPatterns,
        destructive,
        confirmationRequired: false,
        error: exclusionCheck.reason
      } as AuditEntry)

      return result
    }
  }

  // Request confirmation for destructive operations
  if (destructive && confirmationRequired) {
    const confirmed = await requestConfirmation(sql, toolName, ctx)
    if (!confirmed) {
      result.blocked = true
      result.reason = 'Destructive operation not confirmed by user'

      // Log blocked request
      await logger.log({
        sessionId,
        requestNumber: 0,
        toolName,
        sql,
        queryType,
        status: 'blocked',
        exclusions: [],
        destructive,
        confirmationRequired: true,
        error: result.reason
      } as AuditEntry)

      return result
    }
  }

  // Log allowed request
  await logger.log({
    sessionId,
    requestNumber: 0,
    toolName,
    sql: sql || '',
    queryType,
    status: 'executed',
    exclusions: [],
    destructive,
    confirmationRequired,
    executionTime: undefined
  } as AuditEntry)

  return result
}

/**
 * Handle tool execution after hook
 * @param toolName - Name of the tool that was called
 * @param args - Tool arguments
 * @param output - Output from the tool
 * @param config - Proxy configuration
 * @param logger - Audit logger instance
 * @param sessionId - Current session ID
 * @returns Modified output (metadata-only for DATA queries)
 */
async function afterToolHandler(
  toolName: string,
  args: any,
  output: any,
  config: ProxyConfig,
  logger: AuditLogger,
  sessionId: string
): Promise<any> {
  const sql = extractSqlFromArgs(toolName, args)

  // Only process results for queries that return data
  if (!sql) {
    // Non-SQL tools, return as-is
    return output
  }

  const queryType = classifyQuery(sql)

  // Only DATA queries need row data stripping
  if (queryType !== QueryType.DATA) {
    // METADATA queries pass through unchanged
    return output
  }

  // Strip row data from DATA queries
  const metadataResult = await stripRowData(
    output,
    config,
    { client: undefined, project: undefined, $: undefined, directory: undefined, worktree: undefined }
  )

  // Update the last log entry with execution details
  // Note: This is a simplified approach - in production, you'd want to
  // update the specific log entry rather than adding a new one
  const lastEntry: AuditEntry = {
    sessionId,
    requestNumber: 0, // This would need to track the actual request number
    toolName,
    sql,
    queryType: 'DATA',
    status: 'executed',
    exclusions: [],
    destructive: isDestructive(sql),
    confirmationRequired: false,
    metadata: metadataResult.metadata,
    executionTime: output.executionTime || 0
  }

  await logger.log(lastEntry)

  return metadataResult
}
