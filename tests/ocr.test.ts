// Sentetik ödül ekranlarında OCR + eşleştirme doğruluğu.
// Önce: python scripts/gen_fixtures.py 40 7
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Domain, loadGameData } from '../src/core/gamedata';
import { decodePng, RewardScanner } from '../src/core/rewards';

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(ROOT, 'tests', 'fixtures', 'generated');
const truthFile = path.join(FIX, 'truth.json');
const has = fs.existsSync(truthFile);

describe.skipIf(!has)('relic ödül OCR (sentetik)', () => {
  const gd = loadGameData(path.join(ROOT, 'resources', 'gamedata.json'));
  const domain = new Domain(gd, { fetchedAt: null, bySlug: {} }, null);
  const scanner = new RewardScanner(gd, path.join(ROOT, 'resources', 'tessdata'), fs.mkdtempSync(path.join(os.tmpdir(), 'tess-')));
  const truth: { file: string; lang: string; w: number; h: number; uiScale: number; upper: boolean; names: string[] }[] =
    has ? JSON.parse(fs.readFileSync(truthFile, 'utf8')) : [];

  afterAll(() => scanner.dispose());

  it('ödüllerin en az %90\'ını doğru tanır', async () => {
    let ok = 0, total = 0, slotsOk = 0;
    const fails: string[] = [];
    for (const t of truth) {
      const img = decodePng(fs.readFileSync(path.join(FIX, t.file)));
      const r = await scanner.scan(img, domain);
      const got = r.slots.map((s) => s.uniqueName);
      if (got.length === t.names.length) slotsOk++;
      t.names.forEach((n, i) => {
        total++;
        if (got[i] === n) ok++;
        else fails.push(`${t.file} [${t.w}x${t.h} ui${t.uiScale} ${t.lang}${t.upper ? ' UPPER' : ''}] #${i}: beklenen ${gd.items[n].name[t.lang as 'en']} | okunan "${r.slots[i]?.text ?? '-'}" -> ${got[i] ? gd.items[got[i]!]?.name.en : 'yok'}`);
      });
    }
    const acc = ok / total;
    console.log(`doğruluk ${(acc * 100).toFixed(1)}% (${ok}/${total}), slot sayısı doğru ${slotsOk}/${truth.length}`);
    if (fails.length) console.log(fails.join('\n'));
    expect(acc).toBeGreaterThanOrEqual(0.9);
  }, 600_000);
});
