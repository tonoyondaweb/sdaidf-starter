import { z } from 'zod';
import type { QueryToolResult, ErrorResponse } from '../types.js';
import { getConfig } from '../config.js';
import { createExclusionChecker } from '../metadata-proxy/index.js';
import { executeSnowCLI } from '../command-executor.js';

const ExecuteDDLSchema = z.object({
  ddl: z.string().describe('CREATE/ALTER/DROP statement to execute'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

// DDL statement patterns for different object types
const DDL_PATTERNS = {
  CREATE_TABLE: /CREATE\s+TABLE/i,
  CREATE_VIEW: /CREATE\s+(OR\s+REPLACE\s+)?VIEW/i,
  CREATE_FUNCTION: /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i,
  CREATE_PROCEDURE: /CREATE\s+(OR\s+REPLACE\s+)?PROCEDURE/i,
  CREATE_SCHEMA: /CREATE\s+SCHEMA/i,
  CREATE_DATABASE: /CREATE\s+DATABASE/i,
  CREATE_TASK: /CREATE\s+(OR\s+REPLACE\s+)?TASK/i,
  ALTER_TABLE: /ALTER\s+TABLE/i,
  ALTER_VIEW: /ALTER\s+VIEW/i,
  ALTER_SCHEMA: /ALTER\s+SCHEMA/i,
  DROP_TABLE: /DROP\s+TABLE/i,
  DROP_VIEW: /DROP\s+VIEW/i,
  DROP_FUNCTION: /DROP\s+FUNCTION/i,
  DROP_PROCEDURE: /DROP\s+PROCEDURE/i,
  DROP_SCHEMA: /DROP\s+SCHEMA/i,
  DROP_DATABASE: /DROP\s+DATABASE/i,
  DROP_TASK: /DROP\s+TASK/i,
};

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

/**
 * Extract object names from DDL statements
 * This is a heuristic approach - we look for common patterns
 */
function extractObjectNames(ddl: string): string[] {
  const objects: string[] = [];
  
  // Match patterns like: CREATE TABLE schema.table_name, CREATE VIEW db.schema.view_name, etc.
  const createMatches = ddl.matchAll(
    /(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PCEDURE|SCHEMA|DATABASE|TASK|STAGE)\s+([a-zA-Z0-9_.`"]+\.[a-zA-Z0-9_.`"]+\.[a-zA-Z0-9_.`"]+|[a-zA-Z0-9_.`"]+\.[a-zA-Z0-9_.`"]+|[a-zA-Z0-9_]+)/gi
  );
  
  for (const match of createMatches) {
    const objectName = match[1].replace(/[`"]/g, '');
    if (objectName) {
      objects.push(objectName);
    }
  }
  
  return objects;
}

/**
 * Check if DDL contains dangerous operations
 */
function containsDangerousOperation(ddl: string): boolean {
  // Check for DROP statements (without IF EXISTS - though we can't fully prevent issues)
  if (/DROP\s+TABLE/i.test(ddl) || 
      /DROP\s+SCHEMA/i.test(ddl) || 
      /DROP\s+DATABASE/i.test(ddl) ||
      /DROP\s+TASK/i.test(ddl)) {
    return true;
  }
  
  // Check for TRUNCATE
  if (/TRUNCATE\s+TABLE/i.test(ddl)) {
    return true;
  }
  
  return false;
}

/**
 * Classify the type of DDL statement
 */
function classifyDDL(ddl: string): string {
  if (DDL_PATTERNS.CREATE_TABLE.test(ddl)) return 'CREATE_TABLE';
  if (DDL_PATTERNS.CREATE_VIEW.test(ddl)) return 'CREATE_VIEW';
  if (DDL_PATTERNS.CREATE_FUNCTION.test(ddl)) return 'CREATE_FUNCTION';
  if (DDL_PATTERNS.CREATE_PROCEDURE.test(ddl)) return 'CREATE_PROCEDURE';
  if (DDL_PATTERNS.CREATE_SCHEMA.test(ddl)) return 'CREATE_SCHEMA';
  if (DDL_PATTERNS.CREATE_DATABASE.test(ddl)) return 'CREATE_DATABASE';
  if (DDL_PATTERNS.CREATE_TASK.test(ddl)) return 'CREATE_TASK';
  if (DDL_PATTERNS.ALTER_TABLE.test(ddl)) return 'ALTER_TABLE';
  if (DDL_PATTERNS.ALTER_VIEW.test(ddl)) return 'ALTER_VIEW';
  if (DDL_PATTERNS.ALTER_SCHEMA.test(ddl)) return 'ALTER_SCHEMA';
  if (DDL_PATTERNS.DROP_TABLE.test(ddl)) return 'DROP_TABLE';
  if (DDL_PATTERNS.DROP_VIEW.test(ddl)) return 'DROP_VIEW';
  if (DDL_PATTERNS.DROP_FUNCTION.test(ddl)) return 'DROP_FUNCTION';
  if (DDL_PATTERNS.DROP_PROCEDURE.test(ddl)) return 'DROP_PROCEDURE';
  if (DDL_PATTERNS.DROP_SCHEMA.test(ddl)) return 'DROP_SCHEMA';
  if (DDL_PATTERNS.DROP_DATABASE.test(ddl)) return 'DROP_DATABASE';
  if (DDL_PATTERNS.DROP_TASK.test(ddl)) return 'DROP_TASK';
  
  return 'UNKNOWN';
}

export async function executeDDLTool(input: unknown): Promise<QueryToolResult | ErrorResponse> {
  const parsed = ExecuteDDLSchema.safeParse(input);
  
  if (!parsed.success) {
    return createErrorResponse(
      'INVALID_INPUT',
      parsed.error.errors.map(e => e.message).join(', '),
      'E6000'
    );
  }
  
  const { ddl, connection } = parsed.data;
  const config = getConfig();
  
  const exclusionChecker = createExclusionChecker(
    config.exclusions.patterns,
    config.exclusions.objectTypes
  );
  
  // Extract object names from DDL and check exclusions
  const objectNames = extractObjectNames(ddl);
  
  for (const obj of objectNames) {
    // Check each part of the qualified name
    const parts = obj.split('.');
    for (const part of parts) {
      const exclusionResult = exclusionChecker.check(part);
      if (exclusionResult.isExcluded) {
        return createErrorResponse(
          'EXCLUDED_OBJECT',
          `DDL references excluded object: '${part}' matches pattern '${exclusionResult.matchedPattern}'`,
          'E6001'
        );
      }
    }
  }
  
  // Check for dangerous operations
  const hasDangerousOp = containsDangerousOperation(ddl);
  
  // Classify the DDL
  const ddlType = classifyDDL(ddl);
  
  try {
    // Execute the DDL via snow CLI
    const result = await executeSnowCLI(['sql', '-q', ddl], { connection });
    
    if (result.exitCode !== 0) {
      // Check if it's a "doesn't exist" error for DROP/ALTER
      const errorMessage = result.stderr || result.stdout;
      
      if (/does not exist/i.test(errorMessage)) {
        return createErrorResponse(
          'OBJECT_NOT_FOUND',
          errorMessage,
          'E6002'
        );
      }
      
      if (/insufficient privileges/i.test(errorMessage) || /permission denied/i.test(errorMessage)) {
        return createErrorResponse(
          'PERMISSION_DENIED',
          errorMessage,
          'E6003'
        );
      }
      
      return createErrorResponse(
        'DDL_EXECUTION_ERROR',
        errorMessage,
        'E6004'
      );
    }
    
    // Parse success message
    const output = result.stdout.trim();
    
    // Return success response
    return {
      content: [{ type: 'text', text: JSON.stringify({ 
        success: true,
        ddlType,
        objectNames,
        message: 'DDL executed successfully',
        output: output || undefined,
        warning: hasDangerousOp ? 'DDL contained potentially dangerous operations (DROP/TRUNCATE)' : undefined,
      }) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResponse(
      'DDL_EXECUTION_ERROR',
      message,
      'E6005'
    );
  }
}
