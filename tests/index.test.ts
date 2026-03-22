import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('Hono Server', () => {
  it('should return 200 and hello message on /', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const data = await res.json() as { message: string };
    expect(data.message).toBe('Hello, cem-jirou! ✨💖💅');
  });
});
