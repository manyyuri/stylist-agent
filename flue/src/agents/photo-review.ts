'use agent';

import { useModel } from '@flue/runtime';
import { registerDurableBusinessTools } from '../tools.ts';

export function PhotoReview() {
  useModel('opencode-luna/deepseek-v4-flash');
  registerDurableBusinessTools(['review_photo_session']);
  return `你是拍后复盘 Agent。收到 planId 后调用 review_photo_session，等待工具结果后报告精选照片、逐张判断和配色建议。
不得伪造复盘结果；没有样片或计划不存在时如实报告。`;
}
PhotoReview.agentName = 'photo-review';
PhotoReview.durability = { maxAttempts: 3, timeoutMs: 600_000 };
