import fs from 'node:fs';
import { decodePng, crop, binarize } from '../../src/core/rewards';
const f = process.argv[2];
const img = decodePng(fs.readFileSync(`tests/fixtures/generated/${f}`));
const H = img.height, W = img.width, base = H/1080;
const bandW = Math.min(W, 242*base*1.25*4+40);
const band = crop(img, (W-bandW)/2, H*0.36, bandW, H*0.17);
fs.writeFileSync(process.argv[3], binarize(band, Math.max(1, Math.min(3, 2.2/base)), 19*base*1.25));
