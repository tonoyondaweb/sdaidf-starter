import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { executeSqlTool, executeScalarTool } from './tools/query-tools.js';

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
