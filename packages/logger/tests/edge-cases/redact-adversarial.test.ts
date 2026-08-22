import { describe, expect, it } from 'vitest';
import { redactFields } from '../../src/internal/redact.js';

describe('redactFields — adversarial', () => {
  it('redacts a secret buried several levels deep in nested objects and arrays', () => {
    const result = redactFields(
      {
        response: {
          items: [{ id: 1, meta: { auth: { headers: { authorization: 'secret-value' } } } }],
        },
      },
      undefined,
    );
    expect(result).toEqual({
      response: {
        items: [{ id: 1, meta: { auth: { headers: { authorization: '[REDACTED]' } } } }],
      },
    });
  });

  it('scans array elements for secret-shaped strings, not just object keys', () => {
    const result = redactFields({ tags: ['ok', 'user@example.com', 'fine'] }, undefined);
    expect(result).toEqual({ tags: ['ok', '[REDACTED]', 'fine'] });
  });

  it('handles a direct self-reference without infinite recursion', () => {
    const obj: Record<string, unknown> = { name: 'a' };
    obj.self = obj;
    const result = redactFields({ obj }, undefined) as { obj: { name: string; self: unknown } };
    expect(result.obj.name).toBe('a');
    expect(result.obj.self).toBe('[Circular]');
  });

  it('handles a cycle across an array and its container', () => {
    const arr: unknown[] = ['a'];
    const container: Record<string, unknown> = { list: arr };
    arr.push(container);
    const result = redactFields({ container }, undefined) as {
      container: { list: unknown[] };
    };
    expect(result.container.list[0]).toBe('a');
    expect(result.container.list[1]).toBe('[Circular]');
  });

  it('does not falsely flag the same object referenced twice (a DAG, not a cycle)', () => {
    const shared = { value: 'user@example.com' };
    const result = redactFields({ first: shared, second: shared }, undefined);
    expect(result).toEqual({
      first: { value: '[REDACTED]' },
      second: { value: '[REDACTED]' },
    });
  });

  it('replaces functions, symbols, and BigInt with safe placeholders', () => {
    const result = redactFields(
      {
        fn: () => 'x',
        sym: Symbol('s'),
        big: 9007199254740993n,
      },
      undefined,
    );
    expect(result).toEqual({
      fn: '[Function]',
      sym: '[Symbol]',
      big: '9007199254740993n',
    });
  });

  it('produces output that always survives JSON.stringify', () => {
    const obj: Record<string, unknown> = { name: 'a' };
    obj.self = obj;
    const result = redactFields(
      { obj, fn: () => 1, sym: Symbol('s'), big: 1n, date: new Date('2026-01-01T00:00:00.000Z') },
      undefined,
    );
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('stops at maxDepth instead of recursing forever on pathological nesting', () => {
    let node: Record<string, unknown> = { leaf: 'user@example.com' };
    for (let i = 0; i < 50; i++) {
      node = { child: node };
    }
    const result = redactFields({ node }, { maxDepth: 5 });
    expect(JSON.stringify(result)).toContain('[MaxDepthExceeded]');
  });

  it('converts Date, RegExp, Map, and Set to safe representations', () => {
    const result = redactFields(
      {
        when: new Date('2026-01-01T00:00:00.000Z'),
        pattern: /abc/gi,
        m: new Map([['a', 1]]),
        s: new Set([1, 2]),
      },
      undefined,
    );
    expect(result).toEqual({
      when: '2026-01-01T00:00:00.000Z',
      pattern: '/abc/gi',
      m: '[Map(1)]',
      s: '[Set(2)]',
    });
  });

  it('reduces an Error to name and message, dropping the stack', () => {
    const result = redactFields({ err: new Error('boom') }, undefined) as {
      err: { name: string; message: string; stack?: string };
    };
    expect(result.err).toEqual({ name: 'Error', message: 'boom' });
    expect(result.err.stack).toBeUndefined();
  });
});
