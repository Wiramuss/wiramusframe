// Bellek okumadan envanter: EE.log relic satırı, "N Mevcut" rozeti ve envanter ekranı ayrıştırma.
import { expect, test } from 'vitest';
import { loadGameData } from '../src/core/gamedata';
import type { Word } from '../src/core/rewards';
import { buildItemIndex, mergeSeen, parseInventoryWords, parseOwnedBadges, relicFromLogLine } from '../src/core/screeninv';

const W = (text: string, x0: number, y0: number, w = text.length * 11, h = 20): Word => ({ text, x0, y0, x1: x0 + w, y1: y0 + h, conf: 90 });

test('EE.log: açılmak üzere yüklenen relic', () => {
  const line = '1689.188 Sys [Info]: ResourceLoader 0x000002541A0C3010 (/Lotus/Types/Game/Projections/T3VoidProjectionLavosPrimeAPlatinum) Found 23 items to load (0ms)';
  expect(relicFromLogLine(line)).toBe('/Lotus/Types/Game/Projections/T3VoidProjectionLavosPrimeAPlatinum');
  expect(relicFromLogLine('333.769 Sys [Info]: Spot-building /Lotus/Types/Game/Projections/T1VoidProjectionCitrinePrimeDBronze')).toBeNull();
});

test('"2 Mevcut" rozeti doğru slota gider', () => {
  const slots = [{ x: 0, width: 300 }, { x: 300, width: 300 }, { x: 600, width: 300 }];
  expect(parseOwnedBadges([W('2', 420, 10), W('Mevcut', 440, 10)], slots)).toEqual([null, 2, null]);
  expect(parseOwnedBadges([W('5', 20, 10), W('Owned', 40, 10)], slots)).toEqual([5, null, null]);
});

test('envanter ekranı: ad + üstündeki adet', () => {
  const gd = loadGameData('resources/gamedata.json');
  const idx = buildItemIndex(gd);
  const words = [
    W('3', 100, 100), W('Lex', 100, 200), W('Prime', 140, 200), W('Kalıp', 205, 200),
    W('Perigale', 500, 200), W('Prime', 590, 200), W('Dipçik', 655, 200),
    W('Ana', 900, 120), W('Menü', 940, 120),
  ];
  const seen = parseInventoryWords(words, idx, 1080);
  const byName = Object.fromEntries(seen.map((s) => [gd.items[s.ref]?.name.en, s.count]));
  expect(byName['Lex Prime Blueprint']).toBe(3);
  expect(byName['Perigale Prime Stock']).toBe(1);
  expect(seen).toHaveLength(2);
  const inv = mergeSeen(null, seen);
  expect(inv.source).toBe('screen');
  expect(Object.values(inv.counts).sort()).toEqual([1, 3]);
});
