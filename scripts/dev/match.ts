import { loadGameData } from '../../src/core/gamedata';
import { buildRewardIndex } from '../../src/core/rewards';
const idx = buildRewardIndex(loadGameData('resources/gamedata.json'));
for (const t of process.argv.slice(2)) console.log(t, '=>', JSON.stringify(idx.best(t)));
