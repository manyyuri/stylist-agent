import { useTool } from '@flue/runtime';
import * as v from 'valibot';
import { findTool } from '../../server/tools.ts';

type ToolArgs = Record<string, unknown>;
const schemas: Record<string, v.GenericSchema> = {
  get_profile: v.object({}),
  query_wardrobe: v.looseObject({ categories: v.optional(v.array(v.string())), seasons: v.optional(v.array(v.string())), colorFamily: v.optional(v.string()), tags: v.optional(v.array(v.string())), itemId: v.optional(v.string()) }),
  get_weather: v.object({ date: v.optional(v.string()) }),
  generate_outfit: v.object({ date: v.string(), occasion: v.string(), anchor: v.optional(v.string()) }),
  log_outfit_feedback: v.object({ date: v.string(), verdict: v.string() }),
  recommend_makeup: v.object({ occasion: v.string(), anchor: v.optional(v.string()), timeBudget: v.optional(v.number()) }),
  create_photo_plan: v.object({ theme: v.string(), date: v.string(), location: v.string(), sceneType: v.string(), outfitRef: v.optional(v.array(v.string())) }),
  review_photo_session: v.object({ planId: v.string() }),
  wardrobe_gap_check: v.object({}),
};

async function execute(name: string, data: ToolArgs): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) throw new Error(`未知工具：${name}`);
  const parsed = tool.schema.safeParse(data);
  if (!parsed.success) throw new Error(`参数校验失败：${parsed.error.message.slice(0, 300)}`);
  return tool.handler(parsed.data as never, { emit: () => undefined });
}

export function registerBusinessTools(names: string[]) {
  for (const name of names) {
    const schema = schemas[name];
    if (!schema) throw new Error(`未定义 Flue schema：${name}`);
    const tool = findTool(name);
    if (!tool) throw new Error(`未注册业务工具：${name}`);
    useTool({
      name,
      description: tool.description,
      input: schema,
      async run({ data }) {
        return { output: await execute(name, data as ToolArgs) };
      },
    });
  }
}

export function registerDurableBusinessTools(names: string[]) {
  for (const name of names) {
    const schema = schemas[name];
    if (!schema) throw new Error(`未定义 Flue schema：${name}`);
    const tool = findTool(name);
    if (!tool) throw new Error(`未注册业务工具：${name}`);
    useTool({
      name,
      description: `${tool.description} 这是写操作，必须安全重试。`,
      input: schema,
      durable: true,
      async run({ data, step }) {
        const output = await step.do(`${name}:${JSON.stringify(data)}`, () => execute(name, data as ToolArgs));
        return { output };
      },
    });
  }
}
