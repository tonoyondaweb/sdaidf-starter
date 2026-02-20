import { describe, it } from 'node:test';
import assert from 'node:assert';
import { redactResult, redactJsonResult, extractMetadata } from '../../metadata-proxy/result-redactor.js';

describe('Result Redactor', () => {
  describe('redactResult', () => {
    it('extracts columns from result with columns property', () => {
      const result = {
        columns: [
          { name: 'id', type: 'NUMBER' },
          { name: 'name', type: 'STRING' },
        ],
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        rowCount: 2,
      };

      const redacted = redactResult(result);
      
      assert.strictEqual(redacted.metadata.rowCount, 2);
      assert.strictEqual(redacted.data.length, 0);
      assert.strictEqual(redacted.metadata.columns.length, 2);
      assert.strictEqual(redacted.metadata.columns[0].name, 'id');
      assert.strictEqual(redacted.metadata.columns[0].type, 'NUMBER');
      assert.strictEqual(redacted.metadata.columns[0].nullable, true);
    });

    it('handles empty result', () => {
      const redacted = redactResult({});
      
      assert.strictEqual(redacted.metadata.rowCount, 0);
      assert.strictEqual(redacted.metadata.columns.length, 0);
      assert.deepStrictEqual(redacted.data, []);
    });

    it('handles undefined result', () => {
      const redacted = redactResult(undefined);
      
      assert.strictEqual(redacted.metadata.rowCount, 0);
      assert.strictEqual(redacted.metadata.columns.length, 0);
      assert.deepStrictEqual(redacted.data, []);
    });

    it('handles result with no columns', () => {
      const result = {
        rows: [],
        rowCount: 0,
      };

      const redacted = redactResult(result);
      
      assert.strictEqual(redacted.metadata.rowCount, 0);
      assert.strictEqual(redacted.metadata.columns.length, 0);
    });

    it('always returns empty data array', () => {
      const result = {
        columns: [{ name: 'id', type: 'NUMBER' }],
        rows: [{ id: 1 }, { id: 2 }],
        rowCount: 2,
      };

      const redacted = redactResult(result);
      
      assert.deepStrictEqual(redacted.data, []);
    });
  });

  describe('redactJsonResult', () => {
    it('redacts array of objects', () => {
      const jsonString = JSON.stringify([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);

      const redacted = JSON.parse(redactJsonResult(jsonString));
      
      assert.strictEqual(redacted.metadata.rowCount, 2);
      assert.strictEqual(redacted.data.length, 0);
      assert.ok(redacted.metadata.columns);
    });

    it('redacts object with columns/rows format', () => {
      const jsonString = JSON.stringify({
        columns: [{ name: 'id', type: 'NUMBER' }],
        rows: [{ id: 1 }],
        rowCount: 1,
      });

      const redacted = JSON.parse(redactJsonResult(jsonString));
      
      assert.strictEqual(redacted.metadata.rowCount, 1);
      assert.deepStrictEqual(redacted.data, []);
    });

    it('redacts single object', () => {
      const jsonString = JSON.stringify({ id: 1, name: 'Alice' });

      const redacted = JSON.parse(redactJsonResult(jsonString));
      
      assert.strictEqual(redacted.metadata.rowCount, 1);
      assert.deepStrictEqual(redacted.data, []);
    });

    it('handles invalid JSON', () => {
      const result = redactJsonResult('not valid json');
      const parsed = JSON.parse(result);
      
      assert.strictEqual(parsed.error, 'Failed to parse result');
      assert.strictEqual(parsed.raw, '[REDACTED]');
    });

    it('handles empty array', () => {
      const jsonString = JSON.stringify([]);
      
      const redacted = JSON.parse(redactJsonResult(jsonString));
      
      assert.strictEqual(redacted.metadata.rowCount, 0);
      assert.strictEqual(redacted.metadata.columns.length, 0);
    });

    it('handles null value', () => {
      const jsonString = JSON.stringify(null);
      
      const redacted = JSON.parse(redactJsonResult(jsonString));
      
      assert.ok(redacted.metadata);
    });

    it('redacts primitive values', () => {
      const redacted = JSON.parse(redactJsonResult('"simple string"'));
      assert.strictEqual(redacted.value, '[REDACTED]');

      const numRedacted = JSON.parse(redactJsonResult('123'));
      assert.strictEqual(numRedacted.value, '[REDACTED]');
    });
  });

  describe('extractMetadata', () => {
    it('extracts metadata from result object', () => {
      const result = {
        rows: [{ id: 1, name: 'Alice' }],
        rowCount: 1,
        extra: 'value',
      };

      const metadata = extractMetadata(result);
      
      assert.strictEqual(metadata.rowCount, 1);
      assert.strictEqual(metadata.extra, 'value');
    });

    it('handles nested arrays', () => {
      const result = {
        items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
        count: 4,
      };

      const metadata = extractMetadata(result);
      
      assert.deepStrictEqual(metadata.items, { count: 4, sample: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    });

    it('handles nested objects', () => {
      const result = {
        nested: { a: 1, b: 2 },
      };

      const metadata = extractMetadata(result);
      
      assert.deepStrictEqual(metadata.nested, { a: 1, b: 2 });
    });

    it('handles undefined result', () => {
      const metadata = extractMetadata(undefined);
      
      assert.deepStrictEqual(metadata, {});
    });

    it('handles null result', () => {
      const metadata = extractMetadata(null);
      
      assert.deepStrictEqual(metadata, {});
    });

    it('extracts primitives directly', () => {
      const result = {
        count: 42,
        name: 'test',
        active: true,
      };

      const metadata = extractMetadata(result);
      
      assert.strictEqual(metadata.count, 42);
      assert.strictEqual(metadata.name, 'test');
      assert.strictEqual(metadata.active, true);
    });
  });
});
