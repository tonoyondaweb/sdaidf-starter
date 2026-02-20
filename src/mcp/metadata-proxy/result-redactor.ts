import type { ColumnInfo, RedactedResult } from '../types.js';

interface RawQueryResult {
  columns?: Array<{ name: string; type: string }>;
  rows?: Record<string, unknown>[];
  rowCount?: number;
}

export function redactResult(result: unknown): RedactedResult {
  const raw = result as RawQueryResult | undefined;
  
  const columns: ColumnInfo[] = (raw?.columns || []).map(col => ({
    name: col.name,
    type: col.type,
    nullable: true,
  }));
  
  return {
    metadata: {
      columns,
      rowCount: raw?.rowCount ?? 0,
    },
    data: [],
  };
}

export function redactJsonResult(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    
    if (Array.isArray(parsed)) {
      return JSON.stringify({
        metadata: {
          columns: parsed.length > 0 ? extractColumns(parsed[0]) : [],
          rowCount: parsed.length,
        },
        data: [],
      });
    }
    
    if (parsed && typeof parsed === 'object') {
      if (parsed.columns || parsed.rows || parsed.data) {
        return JSON.stringify(redactResult(parsed));
      }
      
      return JSON.stringify({
        metadata: {
          columns: extractColumns(parsed),
          rowCount: 1,
        },
        data: [],
      });
    }
    
    return JSON.stringify({ value: '[REDACTED]' });
  } catch {
    return JSON.stringify({ error: 'Failed to parse result', raw: '[REDACTED]' });
  }
}

function extractColumns(obj: Record<string, unknown>): ColumnInfo[] {
  return Object.keys(obj).map(name => ({
    name,
    type: typeof obj[name],
    nullable: true,
  }));
}

export function extractMetadata(result: unknown): Record<string, unknown> {
  const raw = result as Record<string, unknown> | undefined;
  
  if (!raw) {
    return {};
  }
  
  const metadata: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) {
      metadata[key] = value;
    } else if (Array.isArray(value)) {
      metadata[key] = { count: value.length, sample: value.slice(0, 3) };
    } else {
      metadata[key] = value;
    }
  }
  
  return metadata;
}
