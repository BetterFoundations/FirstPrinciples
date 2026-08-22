import { describe, expect, it } from 'vitest';
import { parseResponseBody, serializeRequestBody } from '../../src/internal/body.js';

describe('parseResponseBody', () => {
  it('parses a JSON body', async () => {
    const response = new Response(JSON.stringify({ id: 1 }), {
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseResponseBody(response)).resolves.toEqual({ id: 1 });
  });

  it('returns undefined for a 204 with no content, without reading the body', async () => {
    const response = new Response(null, { status: 204 });
    await expect(parseResponseBody(response)).resolves.toBeUndefined();
  });

  it('returns undefined for a 205', async () => {
    const response = new Response(null, { status: 205 });
    await expect(parseResponseBody(response)).resolves.toBeUndefined();
  });

  it('returns undefined for a zero-length body regardless of status', async () => {
    const response = new Response('', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseResponseBody(response)).resolves.toBeUndefined();
  });

  it('returns raw text for a non-JSON content type', async () => {
    const response = new Response('plain text', { headers: { 'content-type': 'text/plain' } });
    await expect(parseResponseBody(response)).resolves.toBe('plain text');
  });

  it('returns raw text for a JSON content type with a malformed body, instead of throwing', async () => {
    const response = new Response('{not valid json', {
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseResponseBody(response)).resolves.toBe('{not valid json');
  });

  it('treats a missing content-type as non-JSON', async () => {
    const response = new Response('hello');
    await expect(parseResponseBody(response)).resolves.toBe('hello');
  });
});

describe('serializeRequestBody', () => {
  it('returns undefined for an undefined body', () => {
    expect(serializeRequestBody(undefined)).toBeUndefined();
  });

  it('JSON-stringifies an object body', () => {
    expect(serializeRequestBody({ a: 1 })).toBe('{"a":1}');
  });

  it('serializes null as the literal "null", distinctly from no body at all', () => {
    expect(serializeRequestBody(null)).toBe('null');
  });

  it('serializes a primitive body', () => {
    expect(serializeRequestBody(42)).toBe('42');
    expect(serializeRequestBody('x')).toBe('"x"');
  });
});
