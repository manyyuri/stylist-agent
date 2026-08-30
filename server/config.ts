import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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
}

const raw = JSON.parse(readFileSync(resolve(ROOT, 'config.json'), 'utf8')) as AppConfig;

export const config: AppConfig = {
  ...raw,
  dataDir: raw.dataDir.replace(/^~(?=$|\/)/, process.env.HOME ?? ''),
};

/**
 * 智谱 GLM 配置。不要把 ~/.pi/agent/models.json 中的密钥复制进项目，
 * 通过环境变量注入，避免密钥进入 git 或前端构建产物。
 */
export const GLM_API_KEY = process.env.GLM_API_KEY ?? process.env.ZHIPU_API_KEY ?? '';
export const GLM_BASE_URL = process.env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/coding/paas/v4';

export const ROOT_DIR = ROOT;
