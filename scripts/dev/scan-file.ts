// Bir ekran görüntüsünü tarar ve sonucu yazdırır: npx tsx scripts/dev/scan-file.ts <png>...
import fs from 'node:fs';
import path from 'node:path';
import { Domain, loadGameData } from '../../src/core/gamedata';
import { decodePng, RewardScanner } from '../../src/core/rewards';
const gd = loadGameData('resources/gamedata.json');
const sc = new RewardScanner(gd, path.resolve('resources/tessdata'), path.resolve('.cache'));
const dom = new Domain(gd, { fetchedAt: null, bySlug: {} }, null);
void (async () => {
for (const f of process.argv.slice(2)) {
  const r = await sc.scan(decodePng(fs.readFileSync(f)), dom);
  console.log(path.basename(f), r.ms + 'ms', r.lang, r.slots.map((s) => `${s.name?.tr ?? '?'} (${s.score}) y=${Math.round(s.y)} [${s.text}]`).join(' || '));
}
await sc.dispose();
})();
