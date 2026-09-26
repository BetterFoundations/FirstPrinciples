import { describe, expect, it } from 'vitest';
import { envVar, loadEnv } from '../../src/index.js';

describe('env — adversarial inputs', () => {
  it('rejects a pathological numeric string in linear time (no ReDoS)', () => {
    const hostile = `${'1'.repeat(50_000)}x`;
    const startedAt = performance.now();
    expect(() => envVar.number().parse(hostile)).toThrow('must be a number');
    expect(() => envVar.number().parse(`${'1'.repeat(25_000)}.${'1'.repeat(25_000)}e`)).toThrow();
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it('never reads an inherited property as a variable', () => {
    const result = loadEnv(
      { constructor: envVar.string(), toString: envVar.string(), hasOwnProperty: envVar.string() },
      {},
    );
    expect(!result.ok && result.error.issues.map((i) => i.problem)).toEqual([
      'missing',
      'missing',
      'missing',
    ]);
  });

  it('a spec key named __proto__ becomes a key of the result, not its prototype', () => {
    const spec = JSON.parse('{"__proto__": null}') as Record<string, unknown>;
    spec.__proto__ = envVar.string();
    const source = JSON.parse('{"__proto__": "value"}') as Record<string, string>;
    const result = loadEnv(spec as Record<string, ReturnType<typeof envVar.string>>, source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.keys(result.value)).toEqual(['__proto__']);
  });

  it('works with a null-prototype source', () => {
    const source = Object.assign(Object.create(null) as Record<string, string>, { A: 'a' });
    const result = loadEnv({ A: envVar.string() }, source);
    expect(result.ok && result.value.A).toBe('a');
  });

  it('a custom parser that returns undefined for a set value is honored, not treated as missing', () => {
    const result = loadEnv({ A: envVar.custom(() => undefined) }, { A: 'x' });
    expect(result.ok && 'A' in result.value).toBe(true);
  });
});
