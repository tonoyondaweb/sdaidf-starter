/**
 * Audit logger for Snowflake MCP Proxy Plugin
 * Logs all interactions in Markdown format
 */
import * as fs from 'fs/promises'
import * as path from 'path'
import type { AuditEntry, ColumnSchema } from './types'
import { getTimestamp, sanitizeForMarkdown } from './utils'

/**
 * Audit logger class
 */
export class AuditLogger {
  private requestNumber: number = 0

  constructor(private config: { enabled: boolean; logFile: string }) {}

  /**
   * Log an audit entry
   */
  async log(entry: AuditEntry): Promise<void> {
    if (!this.config.enabled) return

    this.requestNumber++
    entry.requestNumber = this.requestNumber

    const logLine = this.formatMarkdown(entry)

    await fs.mkdir(path.dirname(this.config.logFile), { recursive: true })
    await fs.appendFile(this.config.logFile, logLine + '\n\n')
  }

  /**
   * Format entry as Markdown
   */
  private formatMarkdown(entry: AuditEntry): string {
    const timestamp = getTimestamp()
    const statusIcon = entry.status === 'executed' ? '✅' : '❌'

    let md = `## Session: ${entry.sessionId} | ${timestamp}\n\n`
    md += `### Request #${entry.requestNumber}\n\n`
    md += `**Tool**: \`${entry.toolName}\`\n\n`

    if (entry.sql) {
      md += `**Query**:\n\`\`\`sql\n${entry.sql}\n\`\`\`\n\n`
    }

    md += `**Type**: ${entry.queryType}\n\n`
    md += `**Status**: ${statusIcon} ${entry.status}\n\n`

    if (entry.exclusions.length > 0) {
      md += `**Exclusions**:\n`
      entry.exclusions.forEach(ex => {
        md += `- ${ex}\n`
      })
      md += '\n'
    } else {
      md += `**Exclusions**: None\n\n`
    }

    md += `**Destructive**: ${entry.destructive ? 'Yes' : 'No'}\n\n`
    md += `**Confirmation**: ${entry.confirmationRequired ? 'Required' : 'Not required'}\n\n`

    if (entry.status === 'executed' && entry.metadata) {
      md += `#### Metadata Returned\n\n`
      md += `**Schema**:\n`
      md += `| Column | Type | Null Count | Distinct Count |\n`
      md += `|--------|------|------------|----------------|\n`

      entry.metadata.schema.forEach(col => {
        const nullCount = entry.metadata!.nullCounts[col.name] || 0
        const distinctCount = entry.metadata!.distinctCounts[col.name] || 0
        md += `| ${col.name} | ${col.type} | ${nullCount} | ${distinctCount} |\n`
      })

      md += '\n'
      md += `**Row Count**: ${entry.metadata.rowCount}\n\n`

      if (entry.executionTime) {
        md += `**Execution Time**: ${entry.executionTime}ms\n\n`
      }

      if (entry.metadata.variantInterfaces && Object.keys(entry.metadata.variantInterfaces).length > 0) {
        md += `#### VARIANT Column Interfaces\n\n`

        Object.entries(entry.metadata.variantInterfaces).forEach(([col, iface]) => {
          md += `**Column**: \`${col}\`\n\n`
          md += `\`\`\`typescript\n${iface}\n\`\`\`\n\n`
        })
      }
    }

    if (entry.error) {
      md += `#### Error\n\n`
      md += `\`\`\`\n${entry.error}\n\`\`\`\n\n`
    }

    return md
  }
}

/**
 * Initialize audit log file with header
 */
export async function initializeAuditLogFile(logFile: string): Promise<void> {
  const logPath = path.join(process.cwd(), logFile)

  try {
    // Check if file exists
    await fs.access(logPath)
  } catch {
    // File doesn't exist, create it with header
    const header = `# Snowflake Proxy Audit Log\n\n`
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, header)
  }
}
