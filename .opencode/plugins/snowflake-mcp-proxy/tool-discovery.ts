/**
 * Tool discovery for Snowflake MCP Proxy Plugin
 * Discovers available Snowflake MCP tools using OpenCode client API
 */

/**
 * Discover Snowflake MCP tools via OpenCode client API
 * @param client - OpenCode client instance
 * @returns Array of Snowflake MCP tool names
 */
export async function discoverSnowflakeTools(client: any): Promise<string[]> {
  try {
    // Get all available tools from OpenCode
    const toolsResponse = await client.tool.list({
      query: {
        provider: 'snowflake',
        model: '*'
      }
    })

    if (!toolsResponse.data) {
      console.warn('No tools found via OpenCode client API')
      return []
    }

    const allTools = toolsResponse.data.map((t: any) => t.id)

    // Filter for Snowflake tools (not cortex_*)
    const snowflakeTools = allTools.filter((tool: string) =>
      tool.startsWith('snowflake_') && !tool.startsWith('cortex_')
    )

    console.log(`Discovered ${snowflakeTools.length} Snowflake MCP tools`)

    return snowflakeTools
  } catch (error) {
    console.error('Error discovering Snowflake tools:', error)
    return []
  }
}

/**
 * Fallback tool discovery using known patterns
 * Use this if OpenCode client API is not available
 * @returns Array of known Snowflake MCP tool names
 */
export async function discoverSnowflakeToolsFallback(): Promise<string[]> {
  // Known Snowflake MCP tool patterns
  const knownPatterns = [
    'snowflake_execute_sql',
    'snowflake_list_databases',
    'snowflake_list_schemas',
    'snowflake_list_tables',
    'snowflake_describe_table',
    'snowflake_create_table',
    'snowflake_drop_table',
    'snowflake_alter_table',
    'snowflake_insert',
    'snowflake_update',
    'snowflake_delete',
    'snowflake_truncate_table',
    'snowflake_merge',
    'snowflake_list_views',
    'snowflake_create_view',
    'snowflake_drop_view',
    'snowflake_describe_view'
  ]

  return knownPatterns
}

/**
 * Check if a tool should be intercepted
 * @param toolName - The tool name
 * @param discoveredTools - List of discovered Snowflake tools
 * @param skipPatterns - Patterns of tools to skip
 * @returns Whether the tool should be intercepted
 */
export function shouldIntercept(
  toolName: string,
  discoveredTools: string[],
  skipPatterns: string[]
): boolean {
  // Skip cortex_* tools
  if (skipPatterns.some(pattern => new RegExp(pattern).test(toolName))) {
    return false
  }

  // Intercept all discovered Snowflake tools
  return discoveredTools.includes(toolName)
}
