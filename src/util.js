'use strict';

// Whitespace and quote characters are not allowed.
const KEY_VALUE_RE = /^[^\s"]+$/;

module.exports = {

  assertValidOperation: (operation) => {
    for (let key in operation) {
      module.exports.assertValidKeyValue(key, operation[key]);
    }
  },

  assertValidKeyValue: (key, value) => {
    if (!KEY_VALUE_RE.test(key)) {
      throw new Error(`Invalid operation key: "${key}"`);
    }

    if (typeof value === 'number') {
      return;
    } else if (typeof value !== 'string') {
      throw new Error(`Invalid operation value for key {$key}: not string or number: ${value}`);
    }

    if (!KEY_VALUE_RE.test(value)) {
      throw new Error(`Invalid operation value for key "${key}": "${value}"`);
    }
  },

  operationToString: (operation) => {
    operation = operation || {};
    module.exports.assertValidOperation(operation);
    const pairs = Object.keys(operation).sort().map(k => `"${k}"="${operation[k]}"`);
    return pairs.join(' ');
  },

  removeNullOrUndefinedKeys: operation => {
    const updated = {};

    Object.keys(operation).forEach(key => {
      if (operation[key] !== null && operation[key] !== undefined) {
        updated[key] = operation[key];
      }
    });

    return updated;
  }

};
