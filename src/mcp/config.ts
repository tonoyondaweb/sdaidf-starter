import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { z } from 'zod';
import type { ProjectConfig, ExclusionConfig } from './types.js';

const ProjectConfigSchema = z.object({
  project: z.object({
    name: z.string(),
    version: z.string(),
  }),
  exclusions: z.object({
    patterns: z.array(z.string()),
    objectTypes: z.array(z.string()),
  }),
  snowcli: z.object({
    connection: z.string(),
    defaults: z.object({
      warehouse: z.string().optional(),
      role: z.string().optional(),
    }),
  }),
  guardrail: z.object({
    maxScalarRows: z.number(),
    variantAnalysis: z.object({
      sampleSize: z.number(),
    }),
  }),
  sync: z.object({
    targetDir: z.string(),
  }),
});

const DEFAULT_EXCLUSIONS: ExclusionConfig = {
  patterns: ['^PROD_', '_PROD$', '_BACKUP$', '_ARCHIVE$', '^SYSTEM_'].map(p => new RegExp(p, 'i')),
  objectTypes: ['SNAPSHOT'],
};

const DEFAULT_CONFIG: Omit<ProjectConfig, 'exclusions'> & { exclusions: ExclusionConfig } = {
  project: {
    name: 'snow-cli-mcp-server',
    version: '1.0.0',
  },
  exclusions: DEFAULT_EXCLUSIONS,
  snowcli: {
    connection: 'dev',
    defaults: {},
  },
  guardrail: {
    maxScalarRows: 1000,
    variantAnalysis: {
      sampleSize: 100,
    },
  },
  sync: {
    targetDir: './src',
  },
};

let cachedConfig: ProjectConfig | null = null;

export function loadConfig(configPath?: string): ProjectConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const path = configPath || process.env.SDAIDF_CONFIG_PATH || './project.yaml';

  try {
    const fileContent = readFileSync(path, 'utf-8');
    const parsed = parse(fileContent);
    
    const validated = ProjectConfigSchema.parse(parsed);
    
    const config: ProjectConfig = {
      ...validated,
      exclusions: {
        patterns: validated.exclusions.patterns.map(p => new RegExp(p, 'i')),
        objectTypes: validated.exclusions.objectTypes,
      },
      snowcli: {
        ...validated.snowcli,
        connection: process.env.SNOWFLAKE_CONNECTION || validated.snowcli.connection || 'dev',
      },
    };
    
    cachedConfig = config;
    return config;
  } catch (error) {
    console.warn(`Failed to load config from ${path}, using defaults:`, error);
    const defaultConfig: ProjectConfig = {
      project: DEFAULT_CONFIG.project,
      exclusions: DEFAULT_EXCLUSIONS,
      snowcli: DEFAULT_CONFIG.snowcli,
      guardrail: DEFAULT_CONFIG.guardrail,
      sync: DEFAULT_CONFIG.sync,
    };
    cachedConfig = defaultConfig;
    return defaultConfig;
  }
}

export function getConfig(): ProjectConfig {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}
