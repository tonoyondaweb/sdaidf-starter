import { z } from 'zod';
import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import type { QueryToolResult, ErrorResponse } from '../types.js';
import { getConfig } from '../config.js';
import { createExclusionChecker } from '../metadata-proxy/index.js';
import { executeSnowCLI } from '../command-executor.js';

const SyncObjectsSchema = z.object({
  connection: z.string().optional().describe('Connection name from snow CLI config'),
  targetDir: z.string().describe('Target directory for sync output'),
  includeDatabases: z.boolean().default(true).describe('Include databases in sync'),
  includeSchemas: z.boolean().default(true).describe('Include schemas in sync'),
  includeTables: z.boolean().default(true).describe('Include tables in sync'),
  includeViews: z.boolean().default(true).describe('Include views in sync'),
  includeFunctions: z.boolean().default(false).describe('Include functions in sync'),
  includeProcedures: z.boolean().default(false).describe('Include procedures in sync'),
  includeStages: z.boolean().default(false).describe('Include stages in sync'),
  includeTasks: z.boolean().default(false).describe('Include tasks in sync'),
});

const CheckStalenessSchema = z.object({
  objectName: z.string().describe('Name of the object to check'),
  objectType: z.string().describe('Type of object (table, view, schema, database, etc.)'),
  localPath: z.string().describe('Path to local DDL file'),
  database: z.string().optional().describe('Database name'),
  schema: z.string().optional().describe('Schema name'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

interface SyncResult {
  type: string;
  name: string;
  status: 'synced' | 'skipped' | 'error';
  path?: string;
  error?: string;
}

interface ObjectListItem {
  name: string;
  [key: string]: string;
}

function createErrorResponse(error: string, message: string, code: string): ErrorResponse {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error, message, code }),
    }],
    isError: true,
    error,
    code,
  };
}

async function listObjects(
  objectType: string,
  connection?: string,
  database?: string,
  schema?: string
): Promise<ObjectListItem[]> {
  const args: string[] = ['object', 'list', objectType, '--terse'];
  
  if (database || schema) {
    const scope = database && schema ? `${database}.${schema}` : (database || schema);
    args.push('--in', scope!);
  }
  
  const result = await executeSnowCLI(args, { connection });
  
  if (result.exitCode !== 0) {
    return [];
  }
  
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  
  if (lines.length === 0) {
    return [];
  }
  
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = line.split('\t');
    const obj: ObjectListItem = { name: '' };
    headers.forEach((header, i) => {
      obj[header] = values[i]?.trim() || '';
    });
    return obj;
  });
}

async function getDDL(
  objectType: string,
  objectName: string,
  connection?: string,
  database?: string,
  schema?: string
): Promise<string> {
  const fullName = [
    database || schema ? database : '',
    schema || '',
    objectName
  ].filter(Boolean).join('.');
  
  const normalizedType = objectType.toUpperCase().replace(' ', '_');
  const ddlQuery = `SHOW CREATE ${normalizedType} ${fullName}`;
  
  const result = await executeSnowCLI(['sql', '-q', ddlQuery], { connection });
  
  if (result.exitCode !== 0) {
    return '';
  }
  
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  
  if (lines.length === 0) {
    return '';
  }
  
  const values = lines[0].split('\t');
  return values[values.length - 1]?.trim() || '';
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory may already exist
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export async function syncObjectsTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = SyncObjectsSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E4000'
    );
  }
  
  const { 
    connection, 
    targetDir, 
    includeDatabases,
    includeSchemas,
    includeTables,
    includeViews,
    includeFunctions,
    includeProcedures,
    includeStages,
    includeTasks 
  } = parsed.data;
  
  const config = getConfig();
  
  const exclusionChecker = createExclusionChecker(
    config.exclusions.patterns,
    config.exclusions.objectTypes
  );
  
  const syncResults: SyncResult[] = [];
  
  try {
    // Ensure target directory exists
    await ensureDir(targetDir);
    
    // Sync databases
    if (includeDatabases) {
      const databases = await listObjects('database', connection);
      
      for (const db of databases) {
        const dbName = db.name;
        
        if (!dbName) continue;
        
        const exclusionResult = exclusionChecker.check(dbName);
        if (exclusionResult.isExcluded) {
          syncResults.push({ type: 'database', name: dbName, status: 'skipped', error: 'Excluded by pattern' });
          continue;
        }
        
        const ddl = await getDDL('database', dbName, connection);
        
        if (ddl) {
          const dbPath = join(targetDir, dbName, '_database.sql');
          await ensureDir(dirname(dbPath));
          await writeFile(dbPath, ddl, 'utf-8');
          syncResults.push({ type: 'database', name: dbName, status: 'synced', path: dbPath });
        }
        
        // Sync schemas within database
        if (includeSchemas) {
          const schemas = await listObjects('schema', connection, dbName);
          
          for (const sch of schemas) {
            const schemaName = sch.name;
            
            if (!schemaName) continue;
            
            const fullSchemaName = `${dbName}.${schemaName}`;
            const schemaExclusionResult = exclusionChecker.check(fullSchemaName);
            if (schemaExclusionResult.isExcluded) {
              syncResults.push({ type: 'schema', name: fullSchemaName, status: 'skipped', error: 'Excluded by pattern' });
              continue;
            }
            
            const schemaDdl = await getDDL('schema', schemaName, connection, dbName);
            
            if (schemaDdl) {
              const schemaPath = join(targetDir, dbName, schemaName, '_schema.sql');
              await ensureDir(dirname(schemaPath));
              await writeFile(schemaPath, schemaDdl, 'utf-8');
              syncResults.push({ type: 'schema', name: fullSchemaName, status: 'synced', path: schemaPath });
            }
            
            // Sync tables within schema
            if (includeTables) {
              const tables = await listObjects('table', connection, dbName, schemaName);
              
              for (const tbl of tables) {
                const tableName = tbl.name;
                
                if (!tableName) continue;
                
                const fullTableName = `${dbName}.${schemaName}.${tableName}`;
                const tableExclusionResult = exclusionChecker.check(fullTableName);
                if (tableExclusionResult.isExcluded) {
                  syncResults.push({ type: 'table', name: fullTableName, status: 'skipped', error: 'Excluded by pattern' });
                  continue;
                }
                
                const tableDdl = await getDDL('table', tableName, connection, dbName, schemaName);
                
                if (tableDdl) {
                  const tablePath = join(targetDir, dbName, schemaName, 'tables', `${tableName}.sql`);
                  await ensureDir(dirname(tablePath));
                  await writeFile(tablePath, tableDdl, 'utf-8');
                  syncResults.push({ type: 'table', name: fullTableName, status: 'synced', path: tablePath });
                }
              }
            }
            
            // Sync views within schema
            if (includeViews) {
              const views = await listObjects('view', connection, dbName, schemaName);
              
              for (const vw of views) {
                const viewName = vw.name;
                
                if (!viewName) continue;
                
                const fullViewName = `${dbName}.${schemaName}.${viewName}`;
                const viewExclusionResult = exclusionChecker.check(fullViewName);
                if (viewExclusionResult.isExcluded) {
                  syncResults.push({ type: 'view', name: fullViewName, status: 'skipped', error: 'Excluded by pattern' });
                  continue;
                }
                
                const viewDdl = await getDDL('view', viewName, connection, dbName, schemaName);
                
                if (viewDdl) {
                  const viewPath = join(targetDir, dbName, schemaName, 'views', `${viewName}.sql`);
                  await ensureDir(dirname(viewPath));
                  await writeFile(viewPath, viewDdl, 'utf-8');
                  syncResults.push({ type: 'view', name: fullViewName, status: 'synced', path: viewPath });
                }
              }
            }
            
            // Sync functions within schema
            if (includeFunctions) {
              const functions = await listObjects('function', connection, dbName, schemaName);
              
              for (const fn of functions) {
                const funcName = fn.name;
                
                if (!funcName) continue;
                
                const fullFuncName = `${dbName}.${schemaName}.${funcName}`;
                const funcExclusionResult = exclusionChecker.check(fullFuncName);
                if (funcExclusionResult.isExcluded) {
                  syncResults.push({ type: 'function', name: fullFuncName, status: 'skipped', error: 'Excluded by pattern' });
                  continue;
                }
                
                const funcDdl = await getDDL('function', funcName, connection, dbName, schemaName);
                
                if (funcDdl) {
                  const funcPath = join(targetDir, dbName, schemaName, 'functions', `${funcName}.sql`);
                  await ensureDir(dirname(funcPath));
                  await writeFile(funcPath, funcDdl, 'utf-8');
                  syncResults.push({ type: 'function', name: fullFuncName, status: 'synced', path: funcPath });
                }
              }
            }
            
            // Sync procedures within schema
            if (includeProcedures) {
              const procedures = await listObjects('procedure', connection, dbName, schemaName);
              
              for (const proc of procedures) {
                const procName = proc.name;
                
                if (!procName) continue;
                
                const fullProcName = `${dbName}.${schemaName}.${procName}`;
                const procExclusionResult = exclusionChecker.check(fullProcName);
                if (procExclusionResult.isExcluded) {
                  syncResults.push({ type: 'procedure', name: fullProcName, status: 'skipped', error: 'Excluded by pattern' });
                  continue;
                }
                
                const procDdl = await getDDL('procedure', procName, connection, dbName, schemaName);
                
                if (procDdl) {
                  const procPath = join(targetDir, dbName, schemaName, 'procedures', `${procName}.sql`);
                  await ensureDir(dirname(procPath));
                  await writeFile(procPath, procDdl, 'utf-8');
                  syncResults.push({ type: 'procedure', name: fullProcName, status: 'synced', path: procPath });
                }
              }
            }
            
            // Sync stages within schema
            if (includeStages) {
              const stages = await listObjects('stage', connection, dbName, schemaName);
              
              for (const stg of stages) {
                const stageName = stg.name;
                
                if (!stageName) continue;
                
                const fullStageName = `${dbName}.${schemaName}.${stageName}`;
                const stageExclusionResult = exclusionChecker.check(fullStageName);
                if (stageExclusionResult.isExcluded) {
                  syncResults.push({ type: 'stage', name: fullStageName, status: 'skipped', error: 'Excluded by pattern' });
                  continue;
                }
                
                const stageDdl = await getDDL('stage', stageName, connection, dbName, schemaName);
                
                if (stageDdl) {
                  const stagePath = join(targetDir, dbName, schemaName, 'stages', `${stageName}.sql`);
                  await ensureDir(dirname(stagePath));
                  await writeFile(stagePath, stageDdl, 'utf-8');
                  syncResults.push({ type: 'stage', name: fullStageName, status: 'synced', path: stagePath });
                }
              }
            }
            
            // Sync tasks within schema
            if (includeTasks) {
              const tasks = await listObjects('task', connection, dbName, schemaName);
              
              for (const tsk of tasks) {
                const taskName = tsk.name;
                
                if (!taskName) continue;
                
                const fullTaskName = `${dbName}.${schemaName}.${taskName}`;
                const taskExclusionResult = exclusionChecker.check(fullTaskName);
                if (taskExclusionResult.isExcluded) {
                  syncResults.push({ type: 'task', name: fullTaskName, status: 'skipped', error: 'Excluded by pattern' });
                  continue;
                }
                
                const taskDdl = await getDDL('task', taskName, connection, dbName, schemaName);
                
                if (taskDdl) {
                  const taskPath = join(targetDir, dbName, schemaName, 'tasks', `${taskName}.sql`);
                  await ensureDir(dirname(taskPath));
                  await writeFile(taskPath, taskDdl, 'utf-8');
                  syncResults.push({ type: 'task', name: fullTaskName, status: 'synced', path: taskPath });
                }
              }
            }
          }
        }
      }
    }
    
    // Create index file
    const indexPath = join(targetDir, '.object-repository.json');
    const index = {
      lastSync: new Date().toISOString(),
      targetDir,
      objectCount: syncResults.filter(r => r.status === 'synced').length,
      skippedCount: syncResults.filter(r => r.status === 'skipped').length,
      errorCount: syncResults.filter(r => r.status === 'error').length,
      objects: syncResults,
    };
    await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    
    return {
      content: [{ type: 'text', text: JSON.stringify({ 
        synced: syncResults.filter(r => r.status === 'synced').length,
        skipped: syncResults.filter(r => r.status === 'skipped').length,
        errors: syncResults.filter(r => r.status === 'error').length,
        results: syncResults,
        indexPath,
      }) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      'SYNC_ERROR',
      message,
      'E4001'
    );
  }
}

export async function checkStalenessTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = CheckStalenessSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E5000'
    );
  }
  
  const { objectName, objectType, localPath, database, schema, connection } = parsed.data;
  const config = getConfig();
  
  const exclusionChecker = createExclusionChecker(
    config.exclusions.patterns,
    config.exclusions.objectTypes
  );
  
  // Check exclusions
  const fullObjectName = database || schema ? `${database || ''}.${schema || ''}.${objectName}` : objectName;
  const exclusionResult = exclusionChecker.check(fullObjectName);
  
  if (exclusionResult.isExcluded) {
    return createErrorResponse(
      'EXCLUDED_OBJECT',
      `Object '${fullObjectName}' matches exclusion pattern '${exclusionResult.matchedPattern}'`,
      'E5001'
    );
  }
  
  try {
    // Get current DDL from remote
    const currentDDL = await getDDL(objectType, objectName, connection, database, schema);
    
    if (!currentDDL) {
      return createErrorResponse(
        'OBJECT_NOT_FOUND',
        `Could not retrieve DDL for ${objectType} ${fullObjectName}`,
        'E5002'
      );
    }
    
    // Check if local file exists
    const localExists = await fileExists(localPath);
    
    if (!localExists) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ 
          isStale: true,
          objectName: fullObjectName,
          objectType,
          localPath,
          reason: 'Local file does not exist',
        }) }],
      };
    }
    
    // Read local DDL
    const localDDL = await readFile(localPath, 'utf-8');
    
    // Compare hashes
    const currentHash = simpleHash(currentDDL);
    const localHash = simpleHash(localDDL);
    
    const isStale = currentHash !== localHash;
    
    return {
      content: [{ type: 'text', text: JSON.stringify({ 
        isStale,
        objectName: fullObjectName,
        objectType,
        localPath,
        currentHash,
        localHash,
        reason: isStale ? 'DDL differs from remote' : 'DDL matches remote',
      }) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      'STALENESS_CHECK_ERROR',
      message,
      'E5003'
    );
  }
}
