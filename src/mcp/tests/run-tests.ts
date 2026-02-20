import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../config.js';

const config = loadConfig();

const LOG_DIR = './src/mcp/tests/logs';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = join(LOG_DIR, `test-run-${TIMESTAMP}.log`);

let testOutput = '';

function ensureDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function parseQueryMetadata(output: string): string[] {
  const lines: string[] = [];
  
  const metaRegex = /\[QUERY\]\s*Connection:\s*(\S+)\s*\|\s*Query ID:\s*(\S+)\s*\|\s*([\d\-T:+]+)/g;
  const sqlRegex = /\[QUERY\]\s*SQL:\s*(.+)/g;
  
  let metaMatch;
  let sqlMatch;
  
  const metaMatches: Array<{conn: string, qid: string, time: string, sql: string}> = [];
  
  while ((metaMatch = metaRegex.exec(output)) !== null) {
    metaMatches.push({
      conn: metaMatch[1],
      qid: metaMatch[2],
      time: metaMatch[3],
      sql: '',
    });
  }
  
  const sqlMatches: string[] = [];
  while ((sqlMatch = sqlRegex.exec(output)) !== null) {
    sqlMatches.push(sqlMatch[1]);
  }
  
  for (let i = 0; i < metaMatches.length; i++) {
    if (i < sqlMatches.length) {
      metaMatches[i].sql = sqlMatches[i];
    }
  }
  
  if (metaMatches.length > 0) {
    lines.push('## Query Execution Summary\n\n');
    lines.push('| # | Connection | Query ID | Timestamp | Query |\n');
    lines.push('|---|------------|----------|-----------|-------|\n');
    
    metaMatches.forEach((m, index) => {
      const sql = m.sql ? m.sql.substring(0, 50) : 'N/A';
      lines.push(`| ${index + 1} | ${m.conn} | ${m.qid} | ${m.time} | ${sql}... |\n`);
    });
  }
  
  return lines;
}

function start() {
  ensureDir();

  const connectionName = process.env.SNOW_CONNECTION || config.snowcli.connection;
  
  const header = `# Test Run: ${new Date().toISOString()}
# Environment: Snowflake PROXY_TEST
# Connection: ${connectionName}
# Framework: Node.js native test runner
`;

  const testEnv = process.env.RUN_INTEGRATION_TESTS === 'true'
    ? 'ALL (including live integration)'
    : 'MOCKED (unit, tools, security)';

  writeFileSync(LOG_FILE, header + `# Test Mode: ${testEnv}\n\n---\n\n`);

  const args = process.argv.slice(2);
  const testPaths = args.length > 0 ? args : ['./src/mcp/tests/**/*.test.ts'];

  const testProcess = spawn('tsx', ['--test', ...testPaths], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  testProcess.stdout.on('data', (data) => {
    const text = data.toString();
    testOutput += text;
    process.stdout.write(text);
  });

  testProcess.stderr.on('data', (data) => {
    const text = data.toString();
    testOutput += text;
    process.stderr.write(text);
  });

  testProcess.on('close', (code) => {
    appendFileSync(LOG_FILE, '\n---\n\n');
    appendFileSync(LOG_FILE, `# Test Run Complete: ${new Date().toISOString()}\n`);
    appendFileSync(LOG_FILE, `# Exit Code: ${code}\n`);
    appendFileSync(LOG_FILE, `# Connection Used: ${connectionName}\n`);
    appendFileSync(LOG_FILE, `# Log File: ${LOG_FILE}\n\n`);
    
    const querySummary = parseQueryMetadata(testOutput);
    if (querySummary.length > 0) {
      querySummary.forEach(line => appendFileSync(LOG_FILE, line));
      appendFileSync(LOG_FILE, '\n');
    }
    
    appendFileSync(LOG_FILE, `## Detailed Test Output\n\n`);
    appendFileSync(LOG_FILE, testOutput);
    
    process.exit(code || 0);
  });
}

start();
