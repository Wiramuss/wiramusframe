// Geliştirme: örnek envanterle dolu bir profil klasörü hazırlar.  npx tsx scripts/dev/seed-profile.ts <klasör>
import fs from 'node:fs';
import { loadGameData } from '../../src/core/gamedata';
import { parseInventory } from '../../src/core/inventory';
import { Store, DEFAULT_SETTINGS } from '../../src/core/store';
const dir = process.argv[2];
const gd = loadGameData('resources/gamedata.json');
const st = new Store(dir);
st.saveSettings({ ...DEFAULT_SETTINGS, onboarded: true });
const raw = JSON.parse(fs.readFileSync('tests/fixtures/inventory.sample.json', 'utf8'));
const days = 14;
for (let i = days; i >= 0; i--) {
  const inv = parseInventory(raw, gd, 'import');
  inv.syncedAt = new Date(Date.now() - i * 86400_000).toISOString();
  inv.platinum = 742 + Math.round(Math.sin(i) * 120) + (days - i) * 25;
  inv.ducats = 3150 + (days - i) * 90;
  st.saveInventory(inv);
}
console.log('profil hazır:', dir);
