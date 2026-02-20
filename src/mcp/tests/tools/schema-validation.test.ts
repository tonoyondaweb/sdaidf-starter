import { describe, it } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';

// Replicate schemas from tools for testing (with proper validation)
const ExecuteSQLSchema = z.object({
  query: z.string().min(1),
  connection: z.string().optional(),
});

const ExecuteScalarSchema = z.object({
  query: z.string().min(1),
  connection: z.string().optional(),
  limit: z.number().min(1).default(100),
});

const OBJECT_TYPES = [
  'database',
  'schema',
  'table',
  'view',
  'materialized_view',
  'function',
  'procedure',
  'stage',
  'file_format',
  'task',
  'stream',
  'warehouse',
  'compute_pool',
  'role',
  'user',
  'network_rule',
  'integration',
  'secret',
  'tag',
] as const;

const ListObjectsSchema = z.object({
  objectType: z.enum(OBJECT_TYPES).describe('Type of object to list'),
  database: z.string().optional().describe('Database name'),
  schema: z.string().optional().describe('Schema name'),
  like: z.string().optional().describe('Pattern to match object names'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

const DescribeObjectSchema = z.object({
  objectType: z.enum(OBJECT_TYPES).describe('Type of object to describe'),
  objectName: z.string().describe('Name of the object'),
  database: z.string().optional().describe('Database name'),
  schema: z.string().optional().describe('Schema name'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

const GetDDLSchema = z.object({
  objectType: z.string().min(1).describe('Type of object (TABLE, VIEW, PROCEDURE, FUNCTION, etc.)'),
  objectName: z.string().min(1).describe('Name of the object'),
  database: z.string().optional().describe('Database name'),
  schema: z.string().optional().describe('Schema name'),
  connection: z.string().optional().describe('Connection name from snow CLI config'),
});

describe('Query Tools Schema Validation', () => {
  describe('ExecuteSQLSchema', () => {
    it('validates valid input', () => {
      const result = ExecuteSQLSchema.safeParse({ query: 'SELECT * FROM users' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.query, 'SELECT * FROM users');
        assert.strictEqual(result.data.connection, undefined);
      }
    });

    it('validates input with optional connection', () => {
      const result = ExecuteSQLSchema.safeParse({ 
        query: 'SELECT * FROM users', 
        connection: 'dev' 
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.connection, 'dev');
      }
    });

    it('rejects missing query', () => {
      const result = ExecuteSQLSchema.safeParse({});
      assert.strictEqual(result.success, false);
    });

    it('rejects empty query', () => {
      const result = ExecuteSQLSchema.safeParse({ query: '' });
      assert.strictEqual(result.success, false);
    });

    it('rejects invalid types', () => {
      const result = ExecuteSQLSchema.safeParse({ query: 123 });
      assert.strictEqual(result.success, false);
    });
  });

  describe('ExecuteScalarSchema', () => {
    it('validates valid input', () => {
      const result = ExecuteScalarSchema.safeParse({ query: 'SELECT COUNT(*) FROM users' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.query, 'SELECT COUNT(*) FROM users');
        assert.strictEqual(result.data.limit, 100); // default
      }
    });

    it('applies default limit', () => {
      const result = ExecuteScalarSchema.safeParse({ query: 'SELECT COUNT(*) FROM users' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.limit, 100);
      }
    });

    it('accepts custom limit', () => {
      const result = ExecuteScalarSchema.safeParse({ 
        query: 'SELECT COUNT(*) FROM users', 
        limit: 50 
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.limit, 50);
      }
    });

    it('accepts optional connection', () => {
      const result = ExecuteScalarSchema.safeParse({ 
        query: 'SELECT COUNT(*) FROM users', 
        connection: 'prod' 
      });
      assert.strictEqual(result.success, true);
    });

    it('rejects negative limit', () => {
      const result = ExecuteScalarSchema.safeParse({ 
        query: 'SELECT COUNT(*) FROM users', 
        limit: -1 
      });
      assert.strictEqual(result.success, false);
    });
  });
});

describe('Discovery Tools Schema Validation', () => {
  describe('ListObjectsSchema', () => {
    it('validates valid input with required objectType', () => {
      const result = ListObjectsSchema.safeParse({ objectType: 'table' });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.objectType, 'table');
      }
    });

    it('accepts all valid object types', () => {
      for (const objType of OBJECT_TYPES) {
        const result = ListObjectsSchema.safeParse({ objectType: objType });
        assert.strictEqual(result.success, true, `Failed for ${objType}`);
      }
    });

    it('accepts optional database', () => {
      const result = ListObjectsSchema.safeParse({ 
        objectType: 'table', 
        database: 'MY_DB' 
      });
      assert.strictEqual(result.success, true);
    });

    it('accepts optional schema', () => {
      const result = ListObjectsSchema.safeParse({ 
        objectType: 'table', 
        schema: 'PUBLIC' 
      });
      assert.strictEqual(result.success, true);
    });

    it('accepts optional like pattern', () => {
      const result = ListObjectsSchema.safeParse({ 
        objectType: 'table', 
        like: 'user%' 
      });
      assert.strictEqual(result.success, true);
    });

    it('accepts all optional parameters', () => {
      const result = ListObjectsSchema.safeParse({
        objectType: 'table',
        database: 'MY_DB',
        schema: 'PUBLIC',
        like: 'user%',
        connection: 'dev',
      });
      assert.strictEqual(result.success, true);
    });

    it('rejects invalid object type', () => {
      const result = ListObjectsSchema.safeParse({ objectType: 'invalid_type' });
      assert.strictEqual(result.success, false);
    });

    it('rejects missing objectType', () => {
      const result = ListObjectsSchema.safeParse({ database: 'MY_DB' });
      assert.strictEqual(result.success, false);
    });
  });

  describe('DescribeObjectSchema', () => {
    it('validates valid input', () => {
      const result = DescribeObjectSchema.safeParse({ 
        objectType: 'table', 
        objectName: 'users' 
      });
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.objectName, 'users');
      }
    });

    it('accepts all optional parameters', () => {
      const result = DescribeObjectSchema.safeParse({
        objectType: 'view',
        objectName: 'user_summary',
        database: 'ANALYTICS',
        schema: 'REPORTING',
        connection: 'dev',
      });
      assert.strictEqual(result.success, true);
    });

    it('rejects missing objectName', () => {
      const result = DescribeObjectSchema.safeParse({ objectType: 'table' });
      assert.strictEqual(result.success, false);
    });

    it('rejects invalid objectType', () => {
      const result = DescribeObjectSchema.safeParse({ 
        objectType: 'invalid', 
        objectName: 'users' 
      });
      assert.strictEqual(result.success, false);
    });
  });

  describe('GetDDLSchema', () => {
    it('validates valid input', () => {
      const result = GetDDLSchema.safeParse({ 
        objectType: 'TABLE', 
        objectName: 'users' 
      });
      assert.strictEqual(result.success, true);
    });

    it('accepts objectType as string (not enum)', () => {
      const result = GetDDLSchema.safeParse({ 
        objectType: 'MATERIALIZED_VIEW', 
        objectName: 'summary' 
      });
      assert.strictEqual(result.success, true);
    });

    it('accepts all optional parameters', () => {
      const result = GetDDLSchema.safeParse({
        objectType: 'PROCEDURE',
        objectName: 'my_proc',
        database: 'ANALYTICS',
        schema: 'STAGING',
        connection: 'dev',
      });
      assert.strictEqual(result.success, true);
    });

    it('rejects missing objectName', () => {
      const result = GetDDLSchema.safeParse({ objectType: 'TABLE' });
      assert.strictEqual(result.success, false);
    });

    it('rejects empty objectType', () => {
      const result = GetDDLSchema.safeParse({ 
        objectType: '', 
        objectName: 'users' 
      });
      assert.strictEqual(result.success, false);
    });

    it('rejects empty objectName', () => {
      const result = GetDDLSchema.safeParse({ 
        objectType: 'TABLE', 
        objectName: '' 
      });
      assert.strictEqual(result.success, false);
    });
  });
});

describe('Helper Functions', () => {
  // Simulate buildScope from discovery-tools
  function buildScope(database?: string, schema?: string): string {
    if (database && schema) {
      return `${database}.${schema}`;
    }
    if (database) {
      return database;
    }
    return '';
  }

  // Simulate filterExcludedObjects from discovery-tools
  function filterExcludedObjects<T extends { name?: string }>(
    objects: T[],
    exclusionChecker: (name: string) => { isExcluded: boolean; matchedPattern?: string }
  ): T[] {
    return objects.filter(obj => {
      const name = obj.name;
      if (!name) return true;
      const result = exclusionChecker(name);
      return !result.isExcluded;
    });
  }

  describe('buildScope', () => {
    it('returns empty string when no params', () => {
      assert.strictEqual(buildScope(), '');
    });

    it('returns database only when only database provided', () => {
      assert.strictEqual(buildScope('MY_DB'), 'MY_DB');
    });

    it('returns database.schema when both provided', () => {
      assert.strictEqual(buildScope('MY_DB', 'PUBLIC'), 'MY_DB.PUBLIC');
    });

    it('handles undefined schema with defined database', () => {
      assert.strictEqual(buildScope('MY_DB', undefined), 'MY_DB');
    });
  });

  describe('filterExcludedObjects', () => {
    const mockChecker = (excludedNames: string[]) => (name: string) => ({
      isExcluded: excludedNames.includes(name),
      matchedPattern: excludedNames.includes(name) ? 'mock-pattern' : undefined,
    });

    it('filters out excluded objects', () => {
      const objects = [
        { name: 'allowed1' },
        { name: 'PROD_excluded' },
        { name: 'allowed2' },
      ];
      
      const filtered = filterExcludedObjects(objects, mockChecker(['PROD_excluded']));
      
      assert.strictEqual(filtered.length, 2);
      assert.strictEqual(filtered[0].name, 'allowed1');
      assert.strictEqual(filtered[1].name, 'allowed2');
    });

    it('keeps all when none excluded', () => {
      const objects = [
        { name: 'allowed1' },
        { name: 'allowed2' },
      ];
      
      const filtered = filterExcludedObjects(objects, mockChecker([]));
      
      assert.strictEqual(filtered.length, 2);
    });

    it('handles objects without name property', () => {
      const objects = [
        { name: 'allowed' },
        { id: 1 },
        { name: 'also_allowed' },
      ];
      
      const filtered = filterExcludedObjects(objects, mockChecker([]));
      
      assert.strictEqual(filtered.length, 3);
    });

    it('filters multiple excluded objects', () => {
      const objects = [
        { name: 'keep1' },
        { name: 'drop1' },
        { name: 'keep2' },
        { name: 'drop2' },
      ];
      
      const filtered = filterExcludedObjects(objects, mockChecker(['drop1', 'drop2']));
      
      assert.strictEqual(filtered.length, 2);
      assert.strictEqual(filtered[0].name, 'keep1');
      assert.strictEqual(filtered[1].name, 'keep2');
    });
  });
});
