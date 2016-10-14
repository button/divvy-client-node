'use strict';

class DivvyClientError extends Error {
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

/** Message timed out. */
class TimeoutError extends DivvyClientError {
}

/** Tried to send message while disconnected. */
class DisconnectedError extends DivvyClientError {
}

/** Too many requests in flight. */
class BacklogError extends DivvyClientError {
}

/** Got a bad response from the server. */
class BadResponseError extends DivvyClientError {
}

module.exports = {
  DivvyClientError: DivvyClientError,
  TimeoutError: TimeoutError,
  DisconnectedError: DisconnectedError,
  BacklogError: BacklogError,
  BadResponseError: BadResponseError
};