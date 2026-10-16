import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AI_MODEL, AiError } from '../ai/assistant.js';
import { buildContext, toProposals } from '../ai/proposals.js';
import { can, ensure } from '../auth.js';
import type { AppEnv } from '../env.js';
import { aiKeySchema, aiParseSchema, parseBody } from '../schemas.js';

export const ai = new Hono<AppEnv>();

ai.get('/settings/ai', async (c) => {
  const config = await c.get('store').getAiConfig();
  return c.json({ configured: !!config, model: AI_MODEL });
});

ai.put('/settings/ai', async (c) => {
  ensure(can.admin(c.get('user')), 'Chỉ PMO / quản lý mới cài API key AI');
  const { apiKey } = await parseBody(c.req, aiKeySchema);
  if (!apiKey.startsWith('sk-ant-')) throw new HTTPException(400, { message: 'API key Claude phải bắt đầu bằng sk-ant- (lấy ở console.anthropic.com)' });
  try {
    await c.get('ai').verifyKey(apiKey);
  } catch (e) {
    if (e instanceof AiError) throw new HTTPException(400, { message: e.message });
    throw e;
  }
  await c.get('store').putAiConfig({ apiKey });
  return c.json({ configured: true, model: AI_MODEL });
});

ai.delete('/settings/ai', async (c) => {
  ensure(can.admin(c.get('user')), 'Chỉ PMO / quản lý mới gỡ API key AI');
  await c.get('store').putAiConfig(undefined);
  return c.json({ configured: false, model: AI_MODEL });
});

/** Turns a free-text note into proposed changes; nothing is saved here. */
ai.post('/ai/parse', async (c) => {
  ensure(can.createProject(c.get('user')), 'Chỉ PL trở lên mới dùng nhập bằng AI');
  const { text, projectId } = await parseBody(c.req, aiParseSchema);
  const store = c.get('store');
  const config = await store.getAiConfig();
  if (!config) throw new HTTPException(400, { message: 'PMO chưa cài API key AI (Cài đặt → AI)' });
  const snap = await store.snapshot();
  try {
    const out = await c.get('ai').extract(config.apiKey, buildContext(snap, c.get('now'), c.get('user'), projectId), text);
    return c.json(toProposals(out, snap, projectId));
  } catch (e) {
    if (e instanceof AiError) throw new HTTPException(e.status, { message: e.message });
    throw e;
  }
});
