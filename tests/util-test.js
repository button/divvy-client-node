'use strict';

const assert = require('assert');
const util = require('../src/util');

const VALID_OPERATIONS = [
  {},
  { shoes: 'feet'},
  { shoes: 'feet', bangles: 'arm' }
];

const INVALID_OPERATIONS = [
  { hello: new Error() },
  { shoes: { dont: 'lie '} },
  { titanic: 'greatest\nmovie\nevar' },
  { 'i want to be': 'under_the_sea' }
];

describe('src/util', () => {

  describe('#assertValidOperation', () => {

    it('for valid operations', () => {
      for (let oper of VALID_OPERATIONS) {
        util.assertValidOperation(oper);
      }
    });

    it('for invalid operations', () => {
      for (let oper of INVALID_OPERATIONS) {
        const operStr = JSON.stringify(oper);
        /*jshint -W083 */
        assert.throws(() => util.assertValidOperation(oper), /Invalid operation/,
          `Expected operation ${operStr} to be invalid`);
      }
    });

  });

  describe('#operationToString', () => {
    it('for valid operations', () => {
      assert.equal('', util.operationToString({}));
      assert.equal('', util.operationToString(null));
      assert.equal('"hello"="StLouis"', util.operationToString({ hello: 'StLouis' }));
      assert.equal('"a"="1" "b"="2"', util.operationToString({ 'b': 2, 'a': 1 }));
    });

    it('for invalid operations', () => {
      for (let oper of INVALID_OPERATIONS) {
        /*jshint -W083 */
        assert.throws(() => util.operationToString(oper), /Invalid operation/,
          `Expected operation ${oper} to be invalid`);
      }
    });
  });

  describe('#removeNullOrUndefinedKeys', () => {
    it('removes keys', () => {
      assert.deepEqual({
        human: true,
        name: 'Jim',
        age: 75
      }, util.removeNullOrUndefinedKeys({
        bar: null,
        foo: null,
        human: true,
        alien: undefined,
        name: 'Jim',
        age: 75,
        height: undefined
      }));
    });
  });

});
