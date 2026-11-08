// The residue of a temporary probe, service and unuseful in substance.
// It cannot be deleted: the engine's guard blocks deletion in the `.minimax/` zone, and the node will not
// go around it without the human's code phrase. The probe's meaning moved into `.minimax/scripts/spend-view.cjs`
// (how the engine is seen in the dashboard's spend) - this file is kept as a pointer, not a second source.
console.log(msg('mprobe.residue'));
// The message comes from the core dictionary: English key in code, ru value as data.
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');
