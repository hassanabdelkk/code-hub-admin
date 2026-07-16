import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.output' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(join(root, 'src')).map((file) => relative(root, file));

const offenders = [];

for (const file of files) {
  if (!file.endsWith('.functions.ts') && !file.endsWith('.functions.tsx')) continue;
  const source = readFileSync(join(root, file), 'utf8');
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (/^\s*import\s+.*['"]@\/integrations\/supabase\/client\.server['"]/.test(line)) {
      offenders.push(`${file}:${index + 1}`);
    }
  });
}

if (offenders.length > 0) {
  console.error('\n[server-import-guard] Deployment gestoppt: client.server darf in *.functions.ts nicht auf Modulebene importiert werden.');
  console.error('[server-import-guard] Bitte innerhalb des .handler() nach der Auth-/Admin-Prüfung dynamisch laden:');
  console.error('[server-import-guard] const { supabaseAdmin } = await import("@/integrations/supabase/client.server");');
  console.error(offenders.map((entry) => `  - ${entry}`).join('\n'));
  process.exit(1);
}