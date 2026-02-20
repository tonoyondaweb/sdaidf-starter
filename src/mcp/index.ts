import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { executeSqlTool, executeScalarTool } from './tools/query-tools.js';
import { listObjectsTool, describeObjectTool, getDDLTool } from './tools/discovery-tools.js';
import { getLineageTool, getDependenciesTool } from './tools/lineage-tools.js';
import { syncObjectsTool, checkStalenessTool } from './tools/sync-tools.js';
import { executeDDLTool } from './tools/ddl-tools.js';

const server = new Server(
  {
    name: 'snow-cli-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'execute_sql',
        description: 'Execute a SQL query against Snowflake (metadata-only proxy)',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'execute_scalar',
        description: 'Execute a scalar/aggregation query (returns actual values)',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Scalar/aggregation query (COUNT, SUM, etc.)',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
            limit: {
              type: 'number',
              description: 'Max rows to return (default: 100)',
              default: 100,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_objects',
        description: 'List Snowflake objects by type (tables, views, procedures, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            objectType: {
              type: 'string',
              enum: ['database', 'schema', 'table', 'view', 'materialized_view', 'function', 'procedure', 'stage', 'file_format', 'task', 'stream', 'warehouse', 'compute_pool', 'role', 'user', 'network_rule', 'integration', 'secret', 'tag'],
              description: 'Type of object to list',
            },
            database: {
              type: 'string',
              description: 'Database name',
            },
            schema: {
              type: 'string',
              description: 'Schema name',
            },
            like: {
              type: 'string',
              description: 'Pattern to match object names',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
          },
          required: ['objectType'],
        },
      },
      {
        name: 'describe_object',
        description: 'Get detailed metadata about a Snowflake object (columns, properties)',
        inputSchema: {
          type: 'object',
          properties: {
            objectType: {
              type: 'string',
              enum: ['database', 'schema', 'table', 'view', 'materialized_view', 'function', 'procedure', 'stage', 'file_format', 'task', 'stream', 'warehouse', 'compute_pool', 'role', 'user', 'network_rule', 'integration', 'secret', 'tag'],
              description: 'Type of object to describe',
            },
            objectName: {
              type: 'string',
              description: 'Name of the object',
            },
            database: {
              type: 'string',
              description: 'Database name',
            },
            schema: {
              type: 'string',
              description: 'Schema name',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
          },
          required: ['objectType', 'objectName'],
        },
      },
      {
        name: 'get_ddl',
        description: 'Retrieve CREATE DDL statement for a Snowflake object',
        inputSchema: {
          type: 'object',
          properties: {
            objectType: {
              type: 'string',
              description: 'Type of object (TABLE, VIEW, PROCEDURE, FUNCTION, SCHEMA, DATABASE)',
            },
            objectName: {
              type: 'string',
              description: 'Name of the object',
            },
            database: {
              type: 'string',
              description: 'Database name',
            },
            schema: {
              type: 'string',
              description: 'Schema name',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
          },
          required: ['objectType', 'objectName'],
        },
      },
      {
        name: 'get_lineage',
        description: 'Get upstream/downstream dependencies for a Snowflake object using SNOWFLAKE.CORE.OBJECT_DEPENDENCIES',
        inputSchema: {
          type: 'object',
          properties: {
            objectName: {
              type: 'string',
              description: 'Name of the object',
            },
            objectType: {
              type: 'string',
              enum: ['table', 'view', 'materialized_view'],
              description: 'Type of object (table, view, materialized_view)',
            },
            database: {
              type: 'string',
              description: 'Database name',
            },
            schema: {
              type: 'string',
              description: 'Schema name',
            },
            direction: {
              type: 'string',
              enum: ['upstream', 'downstream', 'both'],
              default: 'both',
              description: 'Direction of dependencies to fetch',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
          },
          required: ['objectName', 'objectType'],
        },
      },
      {
        name: 'get_dependencies',
        description: 'Get direct dependencies for a view, materialized view, function, or procedure',
        inputSchema: {
          type: 'object',
          properties: {
            objectName: {
              type: 'string',
              description: 'Name of the object',
            },
            objectType: {
              type: 'string',
              enum: ['view', 'materialized_view', 'function', 'procedure'],
              description: 'Type of object',
            },
            database: {
              type: 'string',
              description: 'Database name',
            },
            schema: {
              type: 'string',
              description: 'Schema name',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
          },
          required: ['objectName', 'objectType'],
        },
      },
      {
        name: 'sync_objects',
        description: 'Orchestrate discovery tools to build local object repository',
        inputSchema: {
          type: 'object',
          properties: {
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
            targetDir: {
              type: 'string',
              description: 'Target directory for sync output',
            },
            includeDatabases: {
              type: 'boolean',
              default: true,
              description: 'Include databases in sync',
            },
            includeSchemas: {
              type: 'boolean',
              default: true,
              description: 'Include schemas in sync',
            },
            includeTables: {
              type: 'boolean',
              default: true,
              description: 'Include tables in sync',
            },
            includeViews: {
              type: 'boolean',
              default: true,
              description: 'Include views in sync',
            },
            includeFunctions: {
              type: 'boolean',
              default: false,
              description: 'Include functions in sync',
            },
            includeProcedures: {
              type: 'boolean',
              default: false,
              description: 'Include procedures in sync',
            },
            includeStages: {
              type: 'boolean',
              default: false,
              description: 'Include stages in sync',
            },
            includeTasks: {
              type: 'boolean',
              default: false,
              description: 'Include tasks in sync',
            },
          },
          required: ['targetDir'],
        },
      },
      {
        name: 'check_staleness',
        description: 'Compare local DDL with remote to detect changes',
        inputSchema: {
          type: 'object',
          properties: {
            objectName: {
              type: 'string',
              description: 'Name of the object to check',
            },
            objectType: {
              type: 'string',
              description: 'Type of object (table, view, schema, database, etc.)',
            },
            localPath: {
              type: 'string',
              description: 'Path to local DDL file',
            },
            database: {
              type: 'string',
              description: 'Database name',
            },
            schema: {
              type: 'string',
              description: 'Schema name',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
          },
          required: ['objectName', 'objectType', 'localPath'],
        },
      },
      {
        name: 'execute_ddl',
        description: 'Execute CREATE/ALTER/DROP statements for Snowflake objects',
        inputSchema: {
          type: 'object',
          properties: {
            ddl: {
              type: 'string',
              description: 'CREATE/ALTER/DROP statement to execute',
            },
            connection: {
              type: 'string',
              description: 'Connection name from snow CLI config',
            },
          },
          required: ['ddl'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<{ content: Array<{ type: string; text: string }> }> => {
  const { name, arguments: args } = request.params;
  
  try {
    switch (name) {
      case 'execute_sql': {
        const result = await executeSqlTool(args);
        return result as { content: Array<{ type: string; text: string }> };
      }
      
      case 'execute_scalar': {
        const result = await executeScalarTool(args);
        return result as { content: Array<{ type: string; text: string }> };
      }
      
      case 'list_objects': {
        const listResult = await listObjectsTool(args);
        return listResult as { content: Array<{ type: string; text: string }> };
      }
      
      case 'describe_object': {
        const describeResult = await describeObjectTool(args);
        return describeResult as { content: Array<{ type: string; text: string }> };
      }
      
      case 'get_ddl': {
        const ddlResult = await getDDLTool(args);
        return ddlResult as { content: Array<{ type: string; text: string }> };
      }
      
      case 'get_lineage': {
        const lineageResult = await getLineageTool(args);
        return lineageResult as { content: Array<{ type: string; text: string }> };
      }
      
      case 'get_dependencies': {
        const depsResult = await getDependenciesTool(args);
        return depsResult as { content: Array<{ type: string; text: string }> };
      }
      
      case 'sync_objects': {
        const syncResult = await syncObjectsTool(args);
        return syncResult as { content: Array<{ type: string; text: string }> };
      }
      
      case 'check_staleness': {
        const stalenessResult = await checkStalenessTool(args);
        return stalenessResult as { content: Array<{ type: string; text: string }> };
      }
      
      case 'execute_ddl': {
        const ddlResult = await executeDDLTool(args);
        return ddlResult as { content: Array<{ type: string; text: string }> };
      }
      
      default:
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` }),
          }],
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: 'INTERNAL_ERROR', message }),
      }],
    };
  }
});

async function main() {
  loadConfig();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('Snow CLI MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
