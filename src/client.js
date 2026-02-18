// @ts-check
'use strict';

const carrier = require('carrier');
const net = require('net');
const Errors = require('./errors');
const util = require('./util');
const EventEmitter = require('events').EventEmitter;

/** @typedef {import('./errors').BacklogError} BacklogError */
/** @typedef {import('./errors').TimeoutError} TimeoutError */
/** @typedef {import('./errors').DisconnectedError} DisconnectedError */
/** @typedef {import('./errors').BadResponseError} BadResponseError */

/**
 * @template T
 * @param {T|undefined} val
 * @param {T} defaultVal
 * @returns {T}
 */
function defaultIfUndefined(val, defaultVal) {
  return val !== undefined ? val : defaultVal;
}

/** @typedef {import('./types').ClientOptions} ClientOptions */
/** @typedef {import('./types').HitResponse} HitResponse */
/** @typedef {import('./types').Operation} Operation */

/**
 * @typedef {Object} PendingRequest
 * @property {string} message the raw protocol message
 * @property {boolean} isRejectedOrResolved whether the request
 *     has already been settled
 * @property {Promise<HitResponse>} [promise] the promise for
 *     this request
 * @property {function(HitResponse): void} [resolve] resolves
 *     the promise
 * @property {function(Error): void} [reject] rejects the promise
 * @property {ReturnType<typeof setTimeout>|null} [timeout] pending timeout handle
 */

/**
 * Basic Divvy protocol client.
 *
 * Commands supported: The only command currently supported is `hit()`.
 *
 * Connection management: The client can be explicitly connected by
 * calling `connect()`. The connection will be kept open as long as possible.
 * If a command is called while the client is disconnected, the command
 * will be enqueued and the client will be connected.
 *
 * @extends EventEmitter
 * @fires Client#connected
 * @fires Client#disconnected
 * @fires Client#error
 */
class Client extends EventEmitter {

  /**
   * Fired when the TCP connection is established.
   * @event Client#connected
   */

  /**
   * Fired when the TCP connection is closed (whether expected or not).
   * @event Client#disconnected
   */

  /**
   * Fired when a socket error occurs.
   * @event Client#error
   * @type {Error}
   */

  /**
   * @param {string} host server hostname
   * @param {number} port server port number
   * @param {ClientOptions} [options] client options
   */
  constructor(host, port, options) {
    super();

    options = options || {};

    /** @type {string} */
    this.host = host || 'localhost';
    /** @type {number} */
    this.port = port || 8321;

    /** @type {net.Socket|null} */
    this.clientSocket = null;
    /** @type {boolean} */
    this.connected = false;

    /** @type {PendingRequest[]} Requests not yet written to the socket. */
    this.requestQueue = [];

    /** @type {PendingRequest[]} Requests awaiting a response. */
    this.responseQueue = [];

    /** @type {boolean} */
    this.autoReconnect = defaultIfUndefined(options.autoReconnect, true);
    /** @type {number} */
    this.maxReconnectAttempts = defaultIfUndefined(options.maxReconnectAttempts, 5);
    /** @type {boolean} */
    this.throttleConnect = defaultIfUndefined(options.throttleConnect, true);
    /** @type {number} */
    this.throttleConnectTimeoutMillis = defaultIfUndefined(
      options.throttleConnectTimeoutMillis, 1000);
    /** @type {number} */
    this.maxPendingRequests = defaultIfUndefined(options.maxPendingRequests, 100);
    /** @type {number|null} */
    this.defaultCommandTimeoutMillis = defaultIfUndefined(
      options.defaultCommandTimeoutMillis, 1000);

    /**
     * @type {ReturnType<typeof setTimeout>|null}
     * Timeout handle, set when the client is unexpectedly closed
     */
    this.connectTimeoutHandle = null;
    /** @type {Date|null} */
    this.lastDisconnectDate = null;
    /** @type {number} */
    this.reconnectAttempts = 0;
    /** @type {() => void} */
    this.onDisconnectedListener = this._onUnexpectedDisconnect.bind(this);
  }

  /**
   * Schedules connection to the server; no-op if already connected.
   * @returns {void}
   */
  connect() {
    if (this.clientSocket || this.connectTimeoutHandle) {
      // Already connected or connecting. Ignore.
      return;
    }

    if (!this.throttleConnect) {
      this._doConnect();
      return;
    }

    var delay = 0;
    if (this.lastDisconnectDate) {
      // @ts-ignore — Date arithmetic is valid in JS
      let age = Math.max(0, new Date() - this.lastDisconnectDate);
      delay = Math.max(0, this.throttleConnectTimeoutMillis - age);
      this.lastDisconnectDate = null;
    }

    if (delay <= 0) {
      this._doConnect();
    } else {
      this.connectTimeoutHandle = setTimeout(() => this._doConnect(), delay);
    }
  }

  /**
   * Manually close the connection. This will not trigger a reconnect.
   * @returns {void}
   */
  close() {
    if (this.connectTimeoutHandle) {
      clearTimeout(this.connectTimeoutHandle);
      this.connectTimeoutHandle = null;
    }

    if (!this.clientSocket) {
      return;
    }

    this.clientSocket.removeListener('close', this.onDisconnectedListener);
    this.clientSocket.destroy();
    this._doDisconnect();
  }

  /**
   * Perform a "hit" command against the given operation.
   * Upon success, the promise is resolved with an object containing
   * fields `isAllowed` (boolean), `currentCredit`, and
   * `nextResetSeconds`.
   *
   * @param {Operation} [operation={}] the operation object, consisting of string key-value pairs
   * @param {number} [timeout] the timeout in millis; if undefined, uses instance
   *     default timeout.
   * @returns {Promise<HitResponse>}
   * @throws {BacklogError} if too many requests are pending
   * @throws {TimeoutError} if the request times out
   * @throws {DisconnectedError} if the connection is closed
   * @throws {BadResponseError} if the server returns an invalid response
   */
  hit(operation, timeout) {
    operation = util.removeNullOrUndefinedKeys(operation || {});

    if (timeout === undefined) {
      timeout = this.defaultCommandTimeoutMillis;
    }

    const numPending = this._numPendingRequests();
    if (numPending >= this.maxPendingRequests) {
      return Promise.reject(new Errors.BacklogError(`Too many pending requests (${numPending})`));
    }

    const operStr = util.operationToString(operation);

    var message;
    if (operStr) {
      message = `HIT ${operStr}\n`;
    } else {
      message = 'HIT\n';
    }

    const pendingRequest = this._enqueueMessage(message, timeout);
    return pendingRequest.promise;
  }

  /**
   * Returns total number of outstanding requests.
   * @private
   * @returns {number}
   */
  _numPendingRequests() {
    // When connected, the requestQueue will typically be near-empty
    // (commands are flushed quickly) and the responseQueue will match
    // the arrival rate.
    //
    // When disconnected, the requestQueue will fill up and the responseQueue
    // will be empty (no writes to socket until connected).
    return this.requestQueue.length + this.responseQueue.length;
  }

  /**
   * Creates the socket and initiates the TCP connection.
   * @private
   * @returns {void}
   */
  _doConnect() {
    this.connectTimeoutHandle = null;
    this.clientSocket = new net.Socket();

    this.clientSocket.connect(this.port, this.host, this._onConnected.bind(this));
    this.clientSocket.on('close', this.onDisconnectedListener);
    this.clientSocket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /**
   * Called when the socket connection is established.
   * @private
   * @returns {void}
   */
  _onConnected() {
    this.connected = true;
    this.reconnectAttempts = 0;

    carrier.carry(this.clientSocket, (line) => {
      this._receivedLine(line);
    });
    this.emit('connected');

    // One or more requests could have been enqueued while waiting to connect.
    this._flushPending();
  }

  /**
   * Cleanup needed with every disconnect.
   * @private
   * @returns {void}
   */
  _doDisconnect() {
    this.connected = false;
    this.clientSocket = null;
    this._rejectAllPending();
    this.emit('disconnected');
  }

  /**
   * Handles an unexpected socket close; triggers auto-reconnect
   * if enabled.
   * @private
   * @returns {void}
   */
  _onUnexpectedDisconnect() {
    this.lastDisconnectDate = new Date();
    this._doDisconnect();
    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.connect();
    }
  }

  /**
   * Immediately rejects all requests, whether or not they have
   * been sent.
   * @private
   * @returns {void}
   */
  _rejectAllPending() {
    while (this.requestQueue.length) {
      let elem = this.requestQueue.shift();
      if (elem.isRejectedOrResolved) {
        continue;
      }
      elem.reject(new Errors.DisconnectedError('Connection closed.'));
    }

    while (this.responseQueue.length) {
      let elem = this.responseQueue.shift();
      if (elem.isRejectedOrResolved) {
        continue;
      }
      elem.reject(new Errors.DisconnectedError('Connection closed.'));
    }
  }

  /**
   * Parses a protocol response line.
   * @private
   * @param {string} line the raw response line
   * @returns {HitResponse|BadResponseError}
   */
  _parseLine(line) {
    const tokens = line.split(' ');

    if (tokens.length !== 4 || tokens[0] !== 'OK') {
      return new Errors.BadResponseError(line);
    }

    const isAllowed = tokens[1] === 'true';
    const currentCredit = parseInt(tokens[2], 10);
    const nextResetSeconds = parseInt(tokens[3], 10);

    return {
      isAllowed: isAllowed,
      currentCredit: currentCredit,
      nextResetSeconds: nextResetSeconds
    };
  }

  /**
   * Handles a line received from the server socket.
   * @private
   * @param {string} line the raw response line
   * @returns {void}
   */
  _receivedLine(line) {
    const currentRequest = this.responseQueue.shift();

    if (!currentRequest) {
      throw new Errors.BadResponseError('Bug: Received an unexpected response.');
    }

    // If we already rejected the request in flight,
    if (currentRequest.isRejectedOrResolved) {
      return;
    }

    const response = this._parseLine(line);
    if (response instanceof Error) {
      currentRequest.reject(response);
    } else {
      currentRequest.resolve(response);
    }
  }

  /**
   * Enqueues a message to be sent, connecting if necessary.
   * @private
   * @param {string} message the raw protocol message
   * @param {number|null} timeout timeout in milliseconds
   * @returns {PendingRequest}
   */
  _enqueueMessage(message, timeout) {
    const pendingRequest = this._newPendingRequest(message, timeout);
    this.requestQueue.push(pendingRequest);
    if (!this.clientSocket) {
      this.connect();
    } else if (this.connected) {
      this._flushPending();
    }
    return pendingRequest;
  }

  /**
   * Writes all queued requests to the socket.
   * @private
   * @returns {void}
   */
  _flushPending() {
    while (this.requestQueue.length) {
      let pendingRequest = this.requestQueue.shift();
      if (pendingRequest.isRejectedOrResolved) {
        // Request timed out, don't even both sending.
        continue;
      }
      this.clientSocket.write(pendingRequest.message);
      this.responseQueue.push(pendingRequest);
    }
  }

  /**
   * Creates a new pending request with a promise and timeout.
   * @private
   * @param {string} message the raw protocol message
   * @param {number|null} timeout timeout in milliseconds
   * @returns {PendingRequest}
   */
  _newPendingRequest(message, timeout) {
    const pendingRequest = {
      message: message,
      isRejectedOrResolved: false
    };

    pendingRequest.promise = new Promise((resolve, reject) => {
      pendingRequest.resolve = function(obj) {
        if (pendingRequest.isRejectedOrResolved) {
          return;
        }
        if (pendingRequest.timeout) {
          clearTimeout(pendingRequest.timeout);
        }
        pendingRequest.isRejectedOrResolved = true;
        resolve(obj);
      };

      pendingRequest.reject = function(err) {
        if (pendingRequest.isRejectedOrResolved) {
          return;
        }
        if (pendingRequest.timeout) {
          clearTimeout(pendingRequest.timeout);
        }
        pendingRequest.isRejectedOrResolved = true;
        reject(err);
      };

      if (timeout !== undefined && timeout !== null) {
        pendingRequest.timeout = setTimeout(function() {
          pendingRequest.reject(new Errors.TimeoutError('Timeout'));
        }, timeout);
      }
    });

    return pendingRequest;
  }

}

/**
 * Stub of the public interface. Always allows operations without
 * making any network calls.
 *
 * @extends Client
 */
Client.Stub = class DivvyClientStub extends Client {
  /**
   * No-op.
   * @returns {void}
   */
  connect() {
  }

  /**
   * No-op.
   * @returns {void}
   */
  close() {
  }

  /**
   * Always resolves with an allowed response.
   * @returns {Promise<HitResponse>}
   */
  hit() {
    return Promise.resolve({
      isAllowed: true,
      currentCredit: 0,
      nextResetSeconds: 0
    });
  }
};

/** Expose error hierarchy. */
Client.Error = Errors;

module.exports = Client;
