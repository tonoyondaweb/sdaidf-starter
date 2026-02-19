/**
 * Configuration loader for Snowflake MCP Proxy Plugin
 */
import * as yaml from 'yaml'
import * as toml from 'toml'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

/**
 * Proxy configuration interface
 */
export interface ProxyConfig {
  enabled: boolean
  skipPatterns: string[]
  exclusionPatterns: string[]
  requireConfirmation: {
    destructive: boolean
  }
  variantInference: {
    enabled: boolean
    maxSampleSize: number
    samplingFormula: string
  }
  logging: {
    enabled: boolean
    logFile: string
    logLevel: string
  }
  snowflakeMcp: {
    configFile: string
    connectionName: string
  }
}

/**
 * Load proxy configuration from .snowflake-proxy/config.yaml
 */
export async function loadProxyConfig(): Promise<ProxyConfig> {
  const configPath = path.join(process.cwd(), '.snowflake-proxy', 'config.yaml')

  try {
    const configFile = await fs.readFile(configPath, 'utf-8')
    const config = yaml.parse(configFile) as any

    return config.proxy
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Config file not found: ${configPath}`)
      console.warn('Using default configuration')
      return getDefaultConfig()
    }
    throw error
  }
}

/**
 * Load Snowflake connection configuration from ~/.snowflake/config.toml
 */
export async function loadSnowflakeConnectionConfig(): Promise<any> {
  const configPath = path.join(os.homedir(), '.snowflake', 'config.toml')

  try {
    const configFile = await fs.readFile(configPath, 'utf-8')
    const config = toml.parse(configFile)
    return config
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Snowflake config not found: ${configPath}`)
      return {}
    }
    throw error
  }
}

/**
 * Get default proxy configuration
 */
function getDefaultConfig(): ProxyConfig {
  return {
    enabled: true,
    skipPatterns: ['cortex_*'],
    exclusionPatterns: [],
    requireConfirmation: {
      destructive: true
    },
    variantInference: {
      enabled: true,
      maxSampleSize: 1000,
      samplingFormula: 'sqrt'
    },
    logging: {
      enabled: true,
      logFile: '.snowflake-proxy/logs/audit.md',
      logLevel: 'info'
    },
    snowflakeMcp: {
      configFile: 'mcp-snowflake-config.yaml',
      connectionName: 'default'
    }
  }
}
