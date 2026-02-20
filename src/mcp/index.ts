import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { executeSqlTool, executeScalarTool } from './tools/query-tools.js';
import { listObjectsTool, describeObjectTool, getDDLTool } from './tools/discovery-tools.js';

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
