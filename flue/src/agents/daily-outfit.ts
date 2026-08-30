'use agent';

import { useModel } from '@flue/runtime';
import { registerBusinessTools, registerDurableBusinessTools } from '../tools.ts';

export function DailyOutfit() {
  useModel('glm/glm-5.3-flash');
  registerBusinessTools(['get_profile', 'query_wardrobe', 'get_weather']);
  registerDurableBusinessTools(['generate_outfit']);
  return `你是每日穿搭任务 Agent。收到每日任务后，读取档案、天气和真实衣橱，调用 generate_outfit 生成当日 OOTD。
不要覆盖用户已经确认的穿搭；工具失败必须明确报告。`;
}
DailyOutfit.agentName = 'daily-outfit';
DailyOutfit.durability = { maxAttempts: 3, timeoutMs: 120_000 };
