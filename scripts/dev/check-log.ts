import fs from 'node:fs';
import { isCloseLine, isRewardLine } from '../../src/core/eelog';
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
for (const l of lines) if (isRewardLine(l) || isCloseLine(l)) console.log(isRewardLine(l) ? 'AÇ ' : 'KAPA', l.slice(0, 120));
