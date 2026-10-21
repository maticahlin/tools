import { diffmap, resolvePalette, PRESETS } from '../../src/index.js';
import { recolorPixels } from '../../src/core.js';
const c = diffmap({ palette: { mode: 'swap', colors: ['#ff1408', '#fff'] }, cursor: { text: '', font: '16px Arial' }, colorSpace: 'auto' });
c.setText('Vrtec Ljubljana');
const s: 'srgb' | 'display-p3' = c.inspect().space;
const r = resolvePalette({ nodes: PRESETS.riso, anchors: ['#111', { from: '#fff', to: '#000' }] }, { space: 'display-p3' });
recolorPixels(new Uint8ClampedArray(4), { n: [], a: r.fallback.a, d: r.fallback.d, p3: null });
// @ts-expect-error swap needs two colors
diffmap({ palette: { mode: 'swap', colors: ['#fff'] } });
console.log(s);
