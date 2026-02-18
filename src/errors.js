// @ts-check
'use strict';

/**
 * Base error class for all Divvy client errors.
 * @extends Error
 */
class DivvyClientError extends Error {
  /** @param {string} message the error message */
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    this.message = message;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
}

/**
 * Message timed out.
 * @extends DivvyClientError
 */
class TimeoutError extends DivvyClientError {
}

/**
 * Tried to send message while disconnected.
 * @extends DivvyClientError
 */
class DisconnectedError extends DivvyClientError {
}

/**
 * Too many requests in flight.
 * @extends DivvyClientError
 */
class BacklogError extends DivvyClientError {
}

/**
 * Got a bad response from the server.
 * @extends DivvyClientError
 */
class BadResponseError extends DivvyClientError {
}

module.exports = {
  DivvyClientError: DivvyClientError,
  TimeoutError: TimeoutError,
  DisconnectedError: DisconnectedError,
  BacklogError: BacklogError,
  BadResponseError: BadResponseError
};