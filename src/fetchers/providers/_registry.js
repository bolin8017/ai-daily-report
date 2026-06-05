import { ItemSchemas } from '../../schemas/items/index.js';

const _providers = new Map();

function wrap(name, fn) {
  return async (config, ctx) => {
    let result;
    try {
      result = await fn(config, ctx);
    } catch (err) {
      return { ok: false, items: [], error: err.message };
    }
    if (!result?.ok) return result ?? { ok: false, items: [], error: 'no result' };

    const schema = ItemSchemas[ctx.itemType];
    if (!schema) {
      return { ok: false, items: [], error: `unknown itemType: ${ctx.itemType}` };
    }
    const validated = [];
    let rejectedCount = 0;
    for (const item of result.items ?? []) {
      const parsed = schema.safeParse(item);
      if (parsed.success) validated.push(parsed.data);
      else rejectedCount++;
    }
    if (validated.length === 0 && (result.items?.length ?? 0) > 0) {
      return {
        ok: false,
        items: [],
        error: `all ${result.items.length} items failed ${ctx.itemType} validation`,
      };
    }
    if (rejectedCount > 0) {
      console.error(`[provider/${name}] ${rejectedCount} items rejected by ${ctx.itemType} schema`);
    }
    return { ...result, items: validated };
  };
}

export function defineProvider(name, fn) {
  _providers.set(name, wrap(name, fn));
}

export function getProvider(name) {
  const p = _providers.get(name);
  if (!p) throw new Error(`unknown provider: ${name}`);
  return p;
}

export function listProviders() {
  return [..._providers.keys()];
}

export function clearProviders() {
  _providers.clear();
}
