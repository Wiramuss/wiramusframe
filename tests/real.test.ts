// Gerçek oyun ekran görüntüleri (Türkçe istemci, 2560x1440) ile regresyon testi.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { Domain, loadGameData } from '../src/core/gamedata';
import { decodePng, RewardScanner } from '../src/core/rewards';

const gd = loadGameData('resources/gamedata.json');
const scanner = new RewardScanner(gd, path.resolve('resources/tessdata'), path.resolve('.cache'));
const dom = new Domain(gd, { fetchedAt: null, bySlug: {} }, null);
afterAll(() => scanner.dispose());

const CASES: Record<string, string[]> = {
  'reward_tr_3slot_1440p.png': ['Cedo Prime Blueprint', 'Lex Prime Blueprint', 'Perigale Prime Stock'],
  'reward_tr_2slot_1440p.png': ['Cobra & Crane Prime Guard', 'Perigale Prime Stock'],
};

for (const [file, want] of Object.entries(CASES)) {
  test(`gerçek ekran: ${file}`, async () => {
    const r = await scanner.scan(decodePng(fs.readFileSync(path.join('tests/fixtures/real', file))), dom);
    expect(r.slots.map((s) => s.name?.en ?? null)).toEqual(want);
    expect(r.lang).toBe('tr');
    if (file === 'reward_tr_3slot_1440p.png') expect(r.slots.map((s) => s.seenOwned ?? null)).toEqual([null, 2, null]); // "2 Mevcut" rozeti
  }, 120_000);
}
