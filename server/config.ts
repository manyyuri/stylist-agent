import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

export const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY ?? '';
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export const ROOT_DIR = ROOT;
