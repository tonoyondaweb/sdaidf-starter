import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

const LOG_DIR = './src/mcp/tests/logs';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = join(LOG_DIR, `test-run-${TIMESTAMP}.log`);

function ensureDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message: string) {
  appendFileSync(LOG_FILE, message + '\n');
}

function start() {
  ensureDir();
  
  log(`# Test Run: ${new Date().toISOString()}`);
  log(`# Environment: Snowflake PROXY_TEST`);
  log(`# Framework: Node.js native test runner`);
  
  const testEnv = process.env.RUN_INTEGRATION_TESTS === 'true' 
    ? 'ALL (including live integration)' 
    : 'MOCKED (unit, tools, security)';
    
  log(`# Test Mode: ${testEnv}`);
  log('');
  log('---');
  
  const args = process.argv.slice(2).length > 0 
    ? process.argv.slice(2) 
    : ['./src/mcp/tests/**/*.test.ts'];
  
  const testProcess = spawn('tsx', ['--test', ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  });
  
  let output = '';
  
  testProcess.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    process.stdout.write(text);
  });
  
  testProcess.stderr.on('data', (data) => {
    const text = data.toString();
    output += text;
    process.stderr.write(text);
  });
  
  testProcess.on('close', (code) => {
    log('');
    log('---');
    log('');
    log(`# Test Run Complete: ${new Date().toISOString()}`);
    log(`# Exit Code: ${code}`);
    log(`# Log File: ${LOG_FILE}`);
    
    appendFileSync(LOG_FILE, '\n' + output);
    
    process.exit(code || 0);
  });
}

start();
