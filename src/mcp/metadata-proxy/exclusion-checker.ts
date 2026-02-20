import type { ExclusionConfig, ExclusionResult } from '../types.js';

export function createExclusionChecker(patterns: (RegExp | string)[], objectTypes: string[]) {
  const compiledPatterns = patterns.map(p => 
    p instanceof RegExp ? p : new RegExp(p, 'i')
  );
  
  const config: ExclusionConfig = { patterns: compiledPatterns, objectTypes };
  
  return {
    check(objectName: string): ExclusionResult {
      for (const pattern of config.patterns) {
        if (pattern.test(objectName)) {
          return {
            isExcluded: true,
            matchedPattern: pattern.source,
          };
        }
      }
      
      if (config.objectTypes.includes(objectName.toUpperCase())) {
        return {
          isExcluded: true,
          matchedPattern: `objectType:${objectName}`,
        };
      }
      
      return { isExcluded: false };
    },
    
    isExcluded(objectName: string): boolean {
      return this.check(objectName).isExcluded;
    },
  };
}

export function extractObjectNames(query: string): string[] {
  const objectNames: string[] = [];
  
  // Extract main table from FROM clause
  const fromMatch = query.matchAll(/FROM\s+([a-zA-Z0-9_."`]+)/gi);
  for (const match of fromMatch) {
    const name = match[1].replace(/[`"]/g, '').trim();
    if (name && !name.startsWith('(')) {
      objectNames.push(name);
    }
  }
  
  // Extract tables from all JOIN types (INNER, LEFT, RIGHT, OUTER, FULL OUTER)
  const joinPatterns = [
    /JOIN\s+([a-zA-Z0-9_."`]+)/gi,
    /INNER\s+JOIN\s+([a-zA-Z0-9_."`]+)/gi,
    /LEFT\s+JOIN\s+([a-zA-Z0-9_."`]+)/gi,
    /RIGHT\s+JOIN\s+([a-zA-Z0-9_."`]+)/gi,
    /OUTER\s+JOIN\s+([a-zA-Z0-9_."`]+)/gi,
    /FULL\s+OUTER\s+JOIN\s+([a-zA-Z0-9_."`]+)/gi,
  ];
  
  for (const pattern of joinPatterns) {
    const joinMatch = query.matchAll(pattern);
    for (const match of joinMatch) {
      const name = match[1].replace(/[`"]/g, '').trim();
      if (name) {
        objectNames.push(name);
      }
    }
  }
  
  const intoMatch = query.matchAll(/INTO\s+([a-zA-Z0-9_."]+)/gi);
  for (const match of intoMatch) {
    const name = match[1].replace(/[`"]/g, '').trim();
    if (name) {
      objectNames.push(name);
    }
  }
  
  const tableMatch = query.matchAll(/(?:CREATE|ALTER|DROP)\s+TABLE\s+([a-zA-Z0-9_."]+)/gi);
  for (const match of tableMatch) {
    const name = match[1].replace(/[`"]/g, '').trim();
    if (name) {
      objectNames.push(name);
    }
  }
  
  const updateMatch = query.matchAll(/UPDATE\s+([a-zA-Z0-9_."]+)/gi);
  for (const match of updateMatch) {
    const name = match[1].replace(/[`"]/g, '').trim();
    if (name) {
      objectNames.push(name);
    }
  }
  
  return [...new Set(objectNames)];
}
