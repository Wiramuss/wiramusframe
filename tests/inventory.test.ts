import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Domain, expectedMax, loadGameData, rankFromXp } from '../src/core/gamedata';
import { gradeRiven, parseInventory } from '../src/core/inventory';
import { extractSession } from '../src/core/memory';
import { isRewardLine } from '../src/core/eelog';
import { fold, similarity } from '../src/shared/text';

const ROOT = path.resolve(__dirname, '..');
const gd = loadGameData(path.join(ROOT, 'resources', 'gamedata.json'));
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'inventory.sample.json'), 'utf8'));

describe('metin', () => {
  it('Türkçe karakterleri katlar', () => {
    expect(fold('RHINO PRIME NÖROPTİKLERİ KALIP')).toBe(fold('Rhino Prime Nöroptikleri Kalıp'));
    expect(fold('Gövde Kalıp')).toBe('govde kalip');
  });
  it('OCR hatalarına toleranslı', () => {
    expect(similarity(fold('Rhino Prime Noroptikleri Kalip'), fold('Rhino Prime Nöroptikleri Kalıp'))).toBe(1);
    expect(similarity(fold('Rhlno Prlme Gövde'), fold('Rhino Prime Gövde'))).toBeGreaterThan(0.8);
  });
});

describe('envanter', () => {
  const inv = parseInventory(raw, gd, 'import');
  it('para birimlerini okur', () => {
    expect(inv.mr).toBe(18);
    expect(inv.platinum).toBe(742);
    expect(inv.ducats).toBe(3150);
  });
  it('sayıları ve ekipmanı birleştirir', () => {
    expect(Object.keys(inv.counts).length).toBeGreaterThan(150);
    expect(inv.foundry.length).toBe(4);
    expect(Date.parse(inv.foundry[0].readyAt)).toBeGreaterThan(0);
  });
  it('rivenleri ayrıştırır ve notlar', () => {
    expect(inv.rivens.length).toBe(5);
    for (const r of inv.rivens) {
      expect(['S', 'A', 'B', 'C', 'F']).toContain(r.grade);
      expect(r.stats.length).toBeGreaterThanOrEqual(3);
      expect(r.stats.every((s) => s.name.tr)).toBe(true);
    }
  });
  it('alan hesapları çalışır', () => {
    const slug = gd.items[gd.rewardRefs.find((r) => gd.items[r]?.slug)!].slug!;
    const d = new Domain(gd, { fetchedAt: null, bySlug: { [slug]: { plat: 50, vol: 1 } } }, inv);
    expect(d.inventoryRows().length).toBeGreaterThan(50);
    expect(d.sets().some((s) => s.have > 0)).toBe(true);
    expect(d.relicPlan('radiant', true).length).toBeGreaterThan(0);
    const m = d.mastery();
    expect(m.total).toBeGreaterThan(500);
    expect(m.mastered).toBeGreaterThan(0);
  });
});

describe('relic matematiği', () => {
  it('beklenen en yüksek değer', () => {
    const dist = [{ p: 0.5, v: 0 }, { p: 0.5, v: 10 }];
    expect(expectedMax(dist, 1)).toBeCloseTo(5);
    expect(expectedMax(dist, 4)).toBeCloseTo(10 * (1 - 0.5 ** 4));
  });
  it('rütbe hesabı', () => {
    expect(rankFromXp(900000, 'warframe')).toBe(30);
    expect(rankFromXp(450000, 'primary')).toBe(30);
  });
});

describe('bellek / log', () => {
  it('oturum kalıbını bulur', () => {
    const b = Buffer.from('xx GET /api/inventory.php?accountId=0123456789abcdef01234567&nonce=1234567890123 HTTP', 'latin1');
    expect(extractSession(b)).toEqual({ accountId: '0123456789abcdef01234567', nonce: '1234567890123' });
    expect(extractSession(Buffer.from('nothing here'))).toBeNull();
  });
  it('ödül ekranı satırını tanır', () => {
    expect(isRewardLine('12.3 Script [Info]: ProjectionRewardChoice.lua: Got rewards')).toBe(true);
    expect(isRewardLine('12.3 Sys [Info]: loading level')).toBe(false);
  });
  it('riven notlama sınırları', () => {
    expect(gradeRiven([]).grade).toBe('F');
    const g = gradeRiven([
      { tag: 'WeaponCritChanceMod', name: { en: '' }, roll: 1, curse: false },
      { tag: 'WeaponCritDamageMod', name: { en: '' }, roll: 1, curse: false },
      { tag: 'WeaponFireIterationsMod', name: { en: '' }, roll: 1, curse: false },
      { tag: 'WeaponZoomFovMod', name: { en: '' }, roll: 1, curse: true },
    ]);
    expect(g.grade).toBe('S');
  });
});
