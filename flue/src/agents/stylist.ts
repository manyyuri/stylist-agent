'use agent';

import { useModel } from '@flue/runtime';
import { GLM_API_KEY } from '../../../server/config.ts';
import { XIAOPD_SYSTEM } from '../../../server/prompts.ts';
import { registerBusinessTools, registerDurableBusinessTools } from '../tools.ts';

export function Stylist() {
  useModel('glm/glm-5.3-flash');
  registerBusinessTools(['get_profile', 'query_wardrobe', 'get_weather', 'recommend_makeup', 'wardrobe_gap_check']);
  registerDurableBusinessTools(['generate_outfit', 'log_outfit_feedback', 'create_photo_plan', 'review_photo_session']);

  return `${XIAOPD_SYSTEM}

你运行在 Flue 持久化会话中。你必须：
- 涉及真实衣橱时先调用 query_wardrobe 或 get_profile；
- 只能使用工具返回的真实单品 ID，不能编造衣物；
- 生成穿搭、妆造和拍照计划时使用业务工具，不要自行伪造结构化结果；
- 写操作失败时如实说明，不得声称成功；
- 图片识别结果是草稿，必须等待用户确认后才能入库。

当前模型：GLM-5.3-Flash，多模态输入由同一模型处理。
${GLM_API_KEY ? '' : '\n当前未配置 GLM_API_KEY，请说明离线状态。'}`;
}

Stylist.agentName = 'stylist';
Stylist.durability = { maxAttempts: 3, timeoutMs: 120_000 };
