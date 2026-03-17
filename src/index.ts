import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) => {
  return c.json({ message: 'Hello, cem-jirou! ✨💖💅' });
});

export default app;
