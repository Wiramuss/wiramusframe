import fs from 'node:fs';
import path from 'node:path';
import { loadGameData } from '../../src/core/gamedata';
import { decodePng, RewardScanner } from '../../src/core/rewards';
const gd = loadGameData('resources/gamedata.json');
const sc = new RewardScanner(gd, path.resolve('resources/tessdata'), path.resolve('.cache'));
void (async () => {
  const ws = await sc.ocrWords(decodePng(fs.readFileSync(process.argv[2])));
  for (const w of ws) console.log(Math.round(w.x0), Math.round(w.y0), Math.round(w.x1), Math.round(w.y1), Math.round(w.conf), w.text);
  await sc.dispose();
})();
