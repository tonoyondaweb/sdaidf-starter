import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

const LOG_DIR = './src/mcp/tests/logs';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = join(LOG_DIR, `test-run-${TIMESTAMP}.log`);

let testOutput = '';

function ensureDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function start() {
  ensureDir();

  const header = `# Test Run: ${new Date().toISOString()}
# Environment: Snowflake PROXY_TEST
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
    appendFileSync(LOG_FILE, `# Log File: ${LOG_FILE}\n\n`);
    appendFileSync(LOG_FILE, `## Detailed Test Output\n\n`);
    appendFileSync(LOG_FILE, testOutput);
    
    process.exit(code || 0);
  });
}

start();
