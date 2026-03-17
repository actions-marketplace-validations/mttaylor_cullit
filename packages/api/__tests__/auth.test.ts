import { describe, it, expect } from 'vitest';
import { createJWT, verifyJWT } from '../src/auth.js';

describe('Auth Module — JWT', () => {
  it('createJWT returns a valid JWT string', () => {
    const token = createJWT('user-123');
    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyJWT returns the subject for a valid token', () => {
    const token = createJWT('user-456');
    const result = verifyJWT(token);
    expect(result).not.toBeNull();
    expect(result!.sub).toBe('user-456');
  });

  it('verifyJWT rejects a tampered token', () => {
    const token = createJWT('user-789');
    const parts = token.split('.');
    // Tamper with payload
    parts[1] = parts[1] + 'x';
    const tampered = parts.join('.');
    expect(verifyJWT(tampered)).toBeNull();
  });

  it('verifyJWT rejects a malformed token', () => {
    expect(verifyJWT('')).toBeNull();
    expect(verifyJWT('a.b')).toBeNull();
    expect(verifyJWT('not-a-jwt')).toBeNull();
  });

  it('verifyJWT rejects a token with wrong signature', () => {
    const token = createJWT('user-abc');
    const parts = token.split('.');
    // Replace signature with garbage of same length
    parts[2] = 'x'.repeat(parts[2].length);
    expect(verifyJWT(parts.join('.'))).toBeNull();
  });

  it('createJWT produces unique tokens for different users', () => {
    const t1 = createJWT('user-1');
    const t2 = createJWT('user-2');
    expect(t1).not.toBe(t2);
  });
});
