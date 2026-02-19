/**
 * Row data stripper for Snowflake MCP Proxy Plugin
 * Strips all row data from query results and extracts metadata only
 */
import type { SnowflakeQueryResult, MetadataOnlyResult, ColumnSchema, PluginContext, ProxyConfig } from './types'
import { inferVariantInterface } from './variant-inference'

/**
 * Strip row data from Snowflake query result and return metadata only
 * @param result - The query result from Snowflake MCP server
 * @param config - Proxy configuration
 * @param ctx - Plugin context
 * @returns Metadata-only result (no row data)
 */
export async function stripRowData(
  result: SnowflakeQueryResult,
  config: ProxyConfig,
  ctx: PluginContext
): Promise<MetadataOnlyResult> {
  // Handle empty results
  if (!result.rows || result.rows.length === 0) {
    return {
      metadata: {
        schema: result.columns || [],
        rowCount: 0,
        nullCounts: {},
        distinctCounts: {}
      },
      rows: []
    }
  }

  // Extract schema
  const schema = result.columns || extractSchemaFromFirstRow(result.rows[0])

  // Calculate statistics
  const rowCount = result.rows.length
  const nullCounts = calculateNullCounts(result.rows)
  const distinctCounts = calculateDistinctCounts(result.rows)

  // Process VARIANT columns
  const variantColumns = schema.filter(col =>
    col.type.toUpperCase() === 'VARIANT'
  )

  const variantInterfaces: Record<string, string> = {}

  if (config.variantInference.enabled) {
    for (const variantCol of variantColumns) {
      const iface = await inferVariantInterface(
        variantCol.name,
        result.rows,
        config.variantInference,
        ctx
      )
      if (iface) {
        variantInterfaces[variantCol.name] = iface
      }
    }
  }

  return {
    metadata: {
      schema,
      rowCount,
      nullCounts,
      distinctCounts,
      variantInterfaces
    },
    rows: []  // NO ROW DATA RETURNED
  }
}

/**
 * Extract schema from first row of results
 * @param row - First row from result
 * @returns Array of column schemas
 */
function extractSchemaFromFirstRow(row: Record<string, any>): ColumnSchema[] {
  return Object.entries(row).map(([name, value]) => ({
    name,
    type: typeof value
  }))
}

/**
 * Calculate null counts for each column
 * @param rows - Array of result rows
 * @returns Record of column null counts
 */
function calculateNullCounts(rows: Array<Record<string, any>>): Record<string, number> {
  if (rows.length === 0) return {}

  const nullCounts: Record<string, number> = {}

  Object.keys(rows[0]).forEach(col => {
    nullCounts[col] = rows.filter(row => row[col] === null || row[col] === undefined).length
  })

  return nullCounts
}

/**
 * Calculate distinct counts for each column
 * @param rows - Array of result rows
 * @returns Record of column distinct counts
 */
function calculateDistinctCounts(rows: Array<Record<string, any>>): Record<string, number> {
  if (rows.length === 0) return {}

  const distinctCounts: Record<string, number> = {}

  Object.keys(rows[0]).forEach(col => {
    const distinctValues = new Set(rows.map(row => row[col]))
    distinctCounts[col] = distinctValues.size
  })

  return distinctCounts
}
