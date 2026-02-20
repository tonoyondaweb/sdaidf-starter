import { spawn } from 'child_process';
import type { CLIExecutionOptions, CLIResult } from './types.js';

const SNOW_CLI_COMMAND = 'snow';

const DEFAULT_TIMEOUT_MS = 30000;

export async function executeSnowCLI(
  args: string[],
  options: CLIExecutionOptions = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<CLIResult> {
  return new Promise((resolve) => {
    const spawnArgs: string[] = [];
    
    if (options.connection) {
      spawnArgs.push('--connection', options.connection);
    }
    
    if (options.warehouse) {
      spawnArgs.push('--warehouse', options.warehouse);
    }
    
    if (options.role) {
      spawnArgs.push('--role', options.role);
    }
    
    spawnArgs.push(...args);
    
    const proc = spawn(SNOW_CLI_COMMAND, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          stdout,
          stderr: stderr || 'Command timed out',
          exitCode: 124,
        });
      }, timeoutMs);
    }
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
    
    proc.on('error', (err) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

export async function executeSQL(query: string, options: CLIExecutionOptions = {}): Promise<CLIResult> {
  return executeSnowCLI(['sql', '-q', query], options);
}

export async function executeDDL(ddl: string, options: CLIExecutionOptions = {}): Promise<CLIResult> {
  return executeSnowCLI(['sql', '-q', ddl], options);
}

export async function listObjects(
  objectType: string,
  options: CLIExecutionOptions & { database?: string; schema?: string; like?: string } = {}
): Promise<CLIResult> {
  const args = ['object', 'list', objectType];
  
  if (options.database || options.schema) {
    const db = options.database || '*';
    const schema = options.schema || '*';
    args.push('--in', `database=${db}.schema=${schema}`);
  }
  
  if (options.like) {
    args.push('--like', options.like);
  }
  
  return executeSnowCLI(args, options);
}

export async function describeObject(
  objectType: string,
  objectName: string,
  options: CLIExecutionOptions & { database?: string; schema?: string } = {}
): Promise<CLIResult> {
  const args = ['object', 'describe', objectType, objectName];
  
  if (options.database || options.schema) {
    const db = options.database || '';
    const schema = options.schema || '';
    args.push('--in', `database=${db}.schema=${schema}`);
  }
  
  return executeSnowCLI(args, options);
}
