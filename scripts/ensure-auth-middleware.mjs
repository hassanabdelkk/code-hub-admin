import { readFileSync } from 'node:fs';

const start = readFileSync(new URL('../src/start.ts', import.meta.url), 'utf8');

const hasRobustAttacher = start.includes('attachSupabaseBearer') && start.includes('functionMiddleware: [attachSupabaseBearer]');
const hasGeneratedAttacher = start.includes('attachSupabaseAuth');

if (!hasRobustAttacher || hasGeneratedAttacher) {
  console.error('\n[auth-guard] Deployment gestoppt: src/start.ts muss ausschließlich attachSupabaseBearer als functionMiddleware verwenden.');
  console.error('[auth-guard] Damit verhindern wir stale/überschriebene Token-Attacher nach Deploys.');
  process.exit(1);
}
