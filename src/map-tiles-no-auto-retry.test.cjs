const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/app.js`, 'utf8');
const index = fs.readFileSync(`${__dirname}/../index.html`, 'utf8');
const start = source.indexOf('function initializeMapTiles()');
const init = source.slice(start, source.indexOf('\nfunction initializeMap()', start));

class Events {
  handlers = new Map();
  on(names, fn) {
    for (const name of names.split(' ')) {
      if (!this.handlers.has(name)) this.handlers.set(name, []);
      this.handlers.get(name).push(fn);
    }
    return this;
  }
  emit(name, value = {}) { (this.handlers.get(name) || []).forEach(fn => fn(value)); }
}

function fixture() {
  const layer = new Events();
  const window = new Events();
  const document = new Events();
  const statuses = [];
  const map = {};
  let layersAdded = 0;
  layer.addTo = target => { assert.equal(target, map); layersAdded += 1; };
  const context = vm.createContext({
    L: { tileLayer: (url, options) => {
      assert.equal(url, '/tiles/{z}/{x}/{y}.png');
      assert.equal(options.maxNativeZoom, 19);
      return layer;
    } },
    mapTileUrl: () => '/tiles/{z}/{x}/{y}.png', map, window, document,
    setMapStatus: message => statuses.push(message),
    setTimeout: () => assert.fail('No retry timer is allowed'),
    setInterval: () => assert.fail('No retry interval is allowed'),
  });
  vm.runInContext(`${init}\ninitializeMapTiles();`, context);
  return { layer, window, document, statuses, context, layersAdded };
}

test('offline errors, online events and visibility changes never reload a tile', () => {
  const f = fixture();
  let writes = 0;
  const tile = { get src() { return '/tile.png'; }, set src(_) { writes += 1; } };
  f.layer.emit('tileerror', { tile });
  f.window.emit('online');
  f.document.emit('visibilitychange');
  f.layer.emit('load');
  assert.equal(writes, 0);
  assert.equal(f.layersAdded, 1);
  assert.match(f.statuses.at(-1), /자동 재시도는 하지 않습니다/);
});

test('passive error banner clears only after all failed tiles load or unload', () => {
  const f = fixture();
  const first = {}, second = {};
  f.layer.emit('tileerror', { tile: first });
  f.layer.emit('tileerror', { tile: second });
  f.layer.emit('tileload', { tile: first });
  assert.notEqual(f.statuses.at(-1), '');
  f.layer.emit('tileunload', { tile: second });
  assert.equal(f.statuses.at(-1), '');
});

test('layer removal clears passive state without network or timer activity', () => {
  const f = fixture();
  f.layer.emit('tileerror', { tile: {} });
  f.layer.emit('remove');
  assert.equal(f.statuses.at(-1), '');
});

test('UI no longer loads or invokes the automatic tile recovery module', () => {
  assert.doesNotMatch(index, /map-tile-recovery\.js/);
  assert.doesNotMatch(source, /createMapTileRecovery|_map_retry/);
});
