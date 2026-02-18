// @ts-check
'use strict';

// Whitespace and quote characters are not allowed.
const KEY_VALUE_RE = /^[^\s"]+$/;

module.exports = {

  /**
   * Validates that all keys and values in an operation are valid.
   * @param {Object.<string, (string|number)>} operation the operation to validate
   * @throws {Error} if any key or value is invalid
   * @returns {void}
   */
  assertValidOperation: (operation) => {
    for (let key in operation) {
      module.exports.assertValidKeyValue(key, operation[key]);
    }
  },

  /**
   * Validates that a single key-value pair is valid for use in an operation.
   * @param {string} key the operation key
   * @param {string|number} value the operation value
   * @throws {Error} if the key or value is invalid
   * @returns {void}
   */
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

  /**
   * Converts an operation object to its string protocol representation.
   * @param {Object.<string, (string|number)>} [operation] the operation to convert
   * @returns {string} the operation as a protocol string
   */
  operationToString: (operation) => {
    operation = operation || {};
    module.exports.assertValidOperation(operation);
    const pairs = Object.keys(operation).sort().map(k => `"${k}"="${operation[k]}"`);
    return pairs.join(' ');
  },

  /**
   * Returns a copy of the object with any null or undefined values removed.
   * @param {Object.<string, *>} operation the object to filter
   * @returns {Object.<string, *>} a new object with null/undefined values removed
   */
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
