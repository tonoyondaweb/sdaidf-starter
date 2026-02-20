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
  
  const fromMatch = query.match(/FROM\s+([a-zA-Z0-9_."]+)/gi);
  if (fromMatch) {
    for (const match of fromMatch) {
      const name = match.replace(/FROM\s+/i, '').trim();
      objectNames.push(name);
    }
  }
  
  const intoMatch = query.match(/INTO\s+([a-zA-Z0-9_."]+)/gi);
  if (intoMatch) {
    for (const match of intoMatch) {
      const name = match.replace(/INTO\s+/i, '').trim();
      objectNames.push(name);
    }
  }
  
  const tableMatch = query.match(/TABLE\s+([a-zA-Z0-9_."]+)/gi);
  if (tableMatch) {
    for (const match of tableMatch) {
      const name = match.replace(/TABLE\s+/i, '').trim();
      objectNames.push(name);
    }
  }
  
  return [...new Set(objectNames)];
}
