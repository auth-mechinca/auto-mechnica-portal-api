import './helpers/env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { add, compare, multiply, subtract, sum } from '../src/lib/money.js';

/** Every price, total and balance in the system passes through here, so the
 *  failure these guard against is silent money errors rather than crashes. */

describe('money arithmetic', () => {
  it('multiplies exactly where floating point does not', () => {
    // 18.40 * 12.5 is 229.99999999999997 as a double.
    assert.equal(multiply('18.40', '12.5'), '230.00');
    assert.equal(multiply('0.1', '0.2'), '0.02');
    assert.equal(multiply('199.00', '3'), '597.00');
  });

  it('rounds half up', () => {
    assert.equal(multiply('52.50', '1.35'), '70.88');
    assert.equal(multiply('0.005', '1'), '0.01');
  });

  it('adds without drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 as a double.
    assert.equal(add('0.1', '0.2'), '0.3');
    assert.equal(sum(['398.00', '798.00', '33.50']), '1229.50');
    assert.equal(sum([]), '0.00');
  });

  it('subtracts, including below zero', () => {
    assert.equal(subtract('1300.00', '1229.50'), '70.50');
    assert.equal(subtract('100.00', '150.00'), '-50.00');
  });

  it('compares across differing scales', () => {
    assert.equal(compare('100.00', '100.000'), 0);
    assert.equal(compare('99.99', '100.00'), -1);
    assert.equal(compare('1300.00', '1229.50'), 1);
  });

  it('keeps the scale of whole-unit quantities out of the price', () => {
    // Quantities arrive as integers from the till; the price keeps 2dp.
    assert.equal(multiply('33.50', '1'), '33.50');
    assert.equal(multiply('310.00', '2'), '620.00');
  });
});
