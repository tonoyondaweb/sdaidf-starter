/**
 * VARIANT inference for Snowflake MCP Proxy Plugin
 * Infers TypeScript interfaces from VARIANT column data using adaptive sampling
 */
import type { PluginContext, VariantInferenceConfig } from './types'

/**
 * Infer TypeScript interface from VARIANT column data
 * @param columnName - Name of the VARIANT column
 * @param rows - Array of result rows containing the VARIANT column
 * @param config - Variant inference configuration
 * @param ctx - Plugin context
 * @returns TypeScript interface string or null if inference fails
 */
export async function inferVariantInterface(
  columnName: string,
  rows: Array<Record<string, any>>,
  config: VariantInferenceConfig,
  ctx: PluginContext
): Promise<string | null> {
  // Extract VARIANT values
  const variantValues = rows
    .map(row => row[columnName])
    .filter(v => v !== null && v !== undefined)

  if (variantValues.length === 0) {
    return null
  }

  // Calculate sample size using square root formula
  // sampleSize = min(1000, floor(sqrt(totalRows)))
  const totalRows = variantValues.length
  const sampleSize = Math.min(
    config.maxSampleSize,
    Math.floor(Math.sqrt(totalRows))
  )

  console.log(`VARIANT inference for ${columnName}: ${totalRows} rows, sampling ${sampleSize}`)

  // Sample values
  const samples = sampleValues(variantValues, sampleSize)

  // Parse JSON if needed (VARIANT stores as strings or objects)
  const parsedSamples = samples.map(sample => {
    if (typeof sample === 'string') {
      try {
        return JSON.parse(sample)
      } catch {
        return null
      }
    }
    return sample
  }).filter(s => s !== null)

  if (parsedSamples.length === 0) {
    return null
  }

  // Infer TypeScript interface
  const iface = inferTypeScriptInterface(parsedSamples)

  return iface
}

/**
 * Sample values from array
 * @param values - Array of values to sample from
 * @param count - Number of samples to take
 * @returns Array of sampled values
 */
function sampleValues<T>(values: T[], count: number): T[] {
  if (values.length <= count) {
    return values
  }

  // Simple random sampling
  const shuffled = [...values].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

/**
 * Infer TypeScript interface from JSON samples
 * @param samples - Array of parsed JSON objects
 * @returns TypeScript interface string
 */
function inferTypeScriptInterface(samples: any[]): string {
  const schema = inferJsonSchema(samples)
  const typescriptInterface = jsonSchemaToTypeScript(schema)
  return typescriptInterface
}

/**
 * Infer JSON schema from samples
 * @param samples - Array of JSON objects to analyze
 * @returns JSON schema object
 */
function inferJsonSchema(samples: any[]): object {
  const schema = {
    type: 'object',
    properties: {} as Record<string, any>,
    required: [] as string[]
  }

  // Analyze all samples to build comprehensive schema
  samples.forEach(sample => {
    if (typeof sample !== 'object' || sample === null) return

    Object.entries(sample).forEach(([key, value]) => {
      if (!schema.properties[key]) {
        schema.properties[key] = inferType(value)
        schema.required.push(key)
      } else {
        // Merge with existing property type
        schema.properties[key] = mergeTypes(schema.properties[key], inferType(value))
      }
    })
  })

  return schema
}

/**
 * Infer type from a single value
 * @param value - The value to infer type from
 * @returns Type definition
 */
function inferType(value: any): any {
  if (value === null) return { type: 'null' }

  const type = typeof value

  switch (type) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'object':
      if (Array.isArray(value)) {
        if (value.length > 0) {
          return {
            type: 'array',
            items: inferType(value[0])
          }
        }
        return { type: 'array' }
      }
      return inferJsonSchema([value])
    default:
      return { type: 'any' }
  }
}

/**
 * Merge two type definitions
 * @param existing - Existing type definition
 * @param newType - New type to merge
 * @returns Merged type definition
 */
function mergeTypes(existing: any, newType: any): any {
  // Handle union types, optional fields, etc.
  // Simplified implementation
  if (JSON.stringify(existing) === JSON.stringify(newType)) {
    return existing
  }

  return {
    oneOf: [existing, newType]
  }
}

/**
 * Convert JSON schema to TypeScript interface
 * @param schema - JSON schema object
 * @returns TypeScript interface string
 */
function jsonSchemaToTypeScript(schema: any): string {
  let ts = 'interface VariantData {\n'

  if (schema.properties) {
    Object.entries(schema.properties).forEach(([key, typeDef]) => {
      const tsType = typeDefToTypeScript(typeDef)
      const optional = schema.required && !schema.required.includes(key)
      ts += `  ${key}${optional ? '?' : ''}: ${tsType};\n`
    })
  }

  ts += '}'

  return ts
}

/**
 * Convert type definition to TypeScript type string
 * @param typeDef - Type definition
 * @returns TypeScript type string
 */
function typeDefToTypeScript(typeDef: any): string {
  if (typeDef.oneOf) {
    // Union type
    const types = typeDef.oneOf.map((t: any) => typeDefToTypeScript(t))
    return types.join(' | ')
  }

  if (typeDef.type === 'string') {
    return 'string'
  } else if (typeDef.type === 'number') {
    return 'number'
  } else if (typeDef.type === 'boolean') {
    return 'boolean'
  } else if (typeDef.type === 'null') {
    return 'null'
  } else if (typeDef.type === 'array') {
    const itemType = typeDef.items ? typeDefToTypeScript(typeDef.items) : 'any'
    return `${itemType}[]`
  } else if (typeDef.type === 'object') {
    // Nested object - would need recursive call in full implementation
    return 'any'
  }

  return 'any'
}
