import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalVendorName, enrichVendors, filterVendors, vendorSummary } from '../../app/js/vendors-model.js';

test('vendor workbench prioritizes unverified Maker accounts without guessing identity', () => {
  const vendors = [
    { name: '待核实制造者', canonical_name: '待核实制造者', raw_aliases: ['待核实制造者'], scale: 'unverified', account_role: 'unverified', verification: 'unverified', game_count: 1, maker_game_count: 1, heat_total: 100 },
    { name: '已核实大厂', canonical_name: '已核实大厂', raw_aliases: ['已核实大厂'], scale: 'major', account_role: 'mixed', verification: 'verified', game_count: 1, maker_game_count: 0, heat_total: 100000 },
    { name: '普通待核实', canonical_name: '普通待核实', raw_aliases: ['  普通待核实  ', '普通待核实'], scale: 'unverified', account_role: 'unverified', verification: 'unverified', game_count: 1, maker_game_count: 0, heat_total: 20 },
  ];
  const enriched = enrichVendors(vendors);
  assert.equal(enriched[0].name, '待核实制造者');
  assert.equal(enriched[0].queue, 'maker_pending');
  assert.equal(enriched[0].game_count, 1);
  assert.equal(vendorSummary(enriched).pending, 2);
  assert.deepEqual(filterVendors(enriched, { queue: 'verified' }).map(vendor => vendor.name), ['已核实大厂']);
  assert.deepEqual(filterVendors(enriched, { query: '  普通待核实  ' }).map(vendor => vendor.name), ['普通待核实']);
  assert.equal(canonicalVendorName('  ＡＢＣ　发行\t'), 'ABC 发行');
});
