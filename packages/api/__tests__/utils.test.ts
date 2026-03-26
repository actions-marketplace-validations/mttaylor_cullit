import { describe, it, expect } from 'vitest';
import { sanitizeHtml, parseJsonObject, isRecord, toStringArray, readBody } from '../src/utils.js';
import { Readable } from 'stream';
import type { IncomingMessage } from 'http';

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<p>Hello</p><script>alert("xss")</script>')).toBe('<p>Hello</p>');
  });

  it('strips onerror handlers', () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).toBe('<img src="x" />');
  });

  it('strips onclick handlers', () => {
    expect(sanitizeHtml('<a href="#" onclick="steal()">click</a>')).toBe('<a href="#">click</a>');
  });

  it('strips javascript: URLs', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">link</a>');
    expect(result).not.toContain('javascript:');
  });

  it('allows safe tags: h1, h2, img, details, summary', () => {
    const input = '<h1>Title</h1><h2>Sub</h2><img src="pic.jpg" alt="photo"><details><summary>More</summary><p>Info</p></details>';
    const result = sanitizeHtml(input);
    expect(result).toContain('<h1>');
    expect(result).toContain('<h2>');
    expect(result).toContain('<img');
    expect(result).toContain('<details>');
    expect(result).toContain('<summary>');
  });

  it('allows safe img attributes but strips others', () => {
    const result = sanitizeHtml('<img src="pic.jpg" alt="photo" title="t" width="100" height="50" data-custom="bad">');
    expect(result).toContain('src="pic.jpg"');
    expect(result).toContain('alt="photo"');
    expect(result).not.toContain('data-custom');
  });

  it('strips nested script inside allowed tags', () => {
    expect(sanitizeHtml('<details><script>alert(1)</script></details>')).toBe('<details></details>');
  });

  it('strips style tags', () => {
    expect(sanitizeHtml('<style>body{display:none}</style><p>text</p>')).toBe('<p>text</p>');
  });

  it('strips iframe tags', () => {
    expect(sanitizeHtml('<iframe src="https://evil.com"></iframe>')).toBe('');
  });

  it('allows http and https schemes in links', () => {
    expect(sanitizeHtml('<a href="https://cullit.io">link</a>')).toContain('href="https://cullit.io"');
    expect(sanitizeHtml('<a href="http://cullit.io">link</a>')).toContain('href="http://cullit.io"');
  });

  it('allows mailto scheme in links', () => {
    expect(sanitizeHtml('<a href="mailto:hi@cullit.io">email</a>')).toContain('href="mailto:hi@cullit.io"');
  });

  it('strips data: scheme from links', () => {
    const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(result).not.toContain('data:');
  });

  it('handles empty string', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('preserves plain text without tags', () => {
    expect(sanitizeHtml('Hello world')).toBe('Hello world');
  });

  it('handles deeply nested dangerous content', () => {
    const input = '<div><p><span><script>alert(1)</script></span></p></div>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('<script>');
    expect(result).toContain('<div>');
  });
});

describe('parseJsonObject', () => {
  it('parses valid JSON object', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for invalid JSON', () => {
    expect(parseJsonObject('not json')).toBeNull();
  });

  it('returns parsed value for JSON array (arrays pass isRecord)', () => {
    expect(parseJsonObject('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns null for JSON primitive', () => {
    expect(parseJsonObject('"hello"')).toBeNull();
    expect(parseJsonObject('42')).toBeNull();
    expect(parseJsonObject('true')).toBeNull();
    expect(parseJsonObject('null')).toBeNull();
  });

  it('parses nested objects', () => {
    const result = parseJsonObject('{"a":{"b":1}}');
    expect(result).toEqual({ a: { b: 1 } });
  });
});

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isRecord('string')).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });

  it('returns true for arrays (they are objects)', () => {
    expect(isRecord([])).toBe(true);
  });
});

describe('toStringArray', () => {
  it('filters non-strings from array', () => {
    expect(toStringArray(['a', 1, 'b', null], 10)).toEqual(['a', 'b']);
  });

  it('respects limit', () => {
    expect(toStringArray(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });

  it('returns undefined for non-array', () => {
    expect(toStringArray('not array', 10)).toBeUndefined();
    expect(toStringArray(42, 10)).toBeUndefined();
    expect(toStringArray(null, 10)).toBeUndefined();
  });
});

describe('readBody', () => {
  function mockRequest(body: string): IncomingMessage {
    const stream = Readable.from([Buffer.from(body)]);
    return stream as unknown as IncomingMessage;
  }

  it('reads request body', async () => {
    const req = mockRequest('hello world');
    const result = await readBody(req);
    expect(result).toBe('hello world');
  });

  it('reads empty body', async () => {
    const req = mockRequest('');
    const result = await readBody(req);
    expect(result).toBe('');
  });

  it('rejects body over 1MB', async () => {
    const oversize = Buffer.alloc(1_048_577, 'x').toString();
    const req = mockRequest(oversize);
    await expect(readBody(req)).rejects.toThrow('Request body too large');
  });
});
