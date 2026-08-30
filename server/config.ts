import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Flue bundles imported server modules into flue/dist; prefer the process
// workspace so both runtimes read the same config.json and data directory.
const ROOT = existsSync(resolve(process.cwd(), 'config.json')) ? process.cwd() : MODULE_ROOT;

export interface AppConfig {
  port: number;
  dataDir: string; // ~ 开头展开
  models: { text: string; vision: string };
  city: { name: string; lat: number; lon: number };
  /** 小红书 cookies.txt 路径（~ 开头展开；空串则不启用登录态抓取） */
  xhsCookieFile?: string;
}

const raw = JSON.parse(readFileSync(resolve(ROOT, 'config.json'), 'utf8')) as AppConfig;

export const config: AppConfig = {
  ...raw,
  dataDir: raw.dataDir.replace(/^~(?=$|\/)/, process.env.HOME ?? ''),
};

/**
 * 读 pi 模型配置里 `opencode-luna` provider 的 apiKey（密钥不进 git / 构建产物，
 * 只在运行时从 ~/.pi/agent/models.json 读取）。找不到则回退空串（离线降级）。
 */
function opencodeLunaApiKey(): string {
  const home = process.env.HOME ?? '';
  for (const p of [join(home, '.pi', 'agent', 'models.json'), join(home, '.pi', 'models.json')]) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as {
        providers?: Record<string, { apiKey?: string }>;
      };
      const key = j?.providers?.['opencode-luna']?.apiKey;
      if (key) return key;
    } catch {
      /* 文件不存在/解析失败，尝试下一个 */
    }
  }
  return '';
}

/**
 * LLM 网关配置（现指向 opencode.ai/zen/go/v1，模型为 DeepSeek：
 * deepseek-v4-flash 文本 / deepseek-v4-flash-vision-exp 视觉）。
 * 优先级：GLM_API_KEY / ZHIPU_API_KEY 环境变量 > ~/.pi/agent/models.json 的 opencode-luna apiKey。
 */
export const LLM_API_KEY = process.env.GLM_API_KEY ?? process.env.ZHIPU_API_KEY ?? opencodeLunaApiKey();
export const LLM_BASE_URL = process.env.GLM_BASE_URL ?? 'https://opencode.ai/zen/go/v1';

// 兼容旧名（llm.ts / vision.ts / flue 仍引用 GLM_*）
export const GLM_API_KEY = LLM_API_KEY;
export const GLM_BASE_URL = LLM_BASE_URL;

export const ROOT_DIR = ROOT;
