import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.platform === 'win32' ? 'C:/Users/sungs/OneDrive/Desktop/Global_Env' : resolve('.test-runtime');
for (const [key, name] of Object.entries({ PIP_CACHE_DIR:'pip', ULTRALYTICS_CONFIG_DIR:'ultralytics', MPLCONFIGDIR:'matplotlib', TORCH_HOME:'torch', HF_HOME:'huggingface', npm_config_cache:'npm', NODE_COMPILE_CACHE:'node-compile' })) process.env[key] = join(root, 'cache', name);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(root, 'cache', 'playwright');
process.env.SUPABASE_HOME = join(root, 'cache', 'supabase');
process.env.XDG_CONFIG_HOME = join(root, 'cache', 'config');
process.env.XDG_CACHE_HOME = join(root, 'cache');
process.env.XDG_DATA_HOME = join(root, 'cache', 'data');
process.env.WRANGLER_HOME = join(root, 'cache', 'wrangler');
const temp = resolve('temp_work/tests');
mkdirSync(temp, { recursive: true });
for (const key of ['TEMP','TMP','TMPDIR']) process.env[key] = temp;
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.WRANGLER_SEND_METRICS = 'false';
