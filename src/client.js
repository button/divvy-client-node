'use strict';

const carrier = require('carrier');
const net = require('net');
const Errors = require('./errors');
const util = require('./util');
const EventEmitter = require('events').EventEmitter;

function defaultIfUndefined(val, defaultVal) {
  return val !== undefined ? val : defaultVal;
}

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
 * Timeouts:
 */
class Client extends EventEmitter {

  /**
   * Constructor.
   *
   * @param  {string} host    server hostname
   * @param  {number} port    server port number
   * @param  {boolean} options.autoReconnect  whether to automatically reconnect when the
   *     server connection is unexpectedly closed (default true)
   * @param  {number} options.defaultCommandTimeoutMillis  default timeout for commands, or
   *     `null` to not use a timouer (default 1000)
   * @param  {number} options.maxPendingRequests  maximum number of outgoing requests
   *     that are allowed to be in flight at any one time. Requests made over this
   *     limit will be dropped. (default 100)
   * @param  {number} options.maxReconnectAttempts  when `options.autoReconnect` is true,
   *     maximum number of consecutive `connect()` attempts the client will automatically
   *     make before giving up
   * @param  {boolean} options.throttleConnect  whether to throttle calls to `connect()`
   *     such that they will not be attempted more than once every
   *     `options.throttleConnectTimeoutMillis` (default true)
   * @param  {boolean} options.throttleConnectTimeoutMillis  when `throttleConnect` is
   *     `true`, enforce a delay of this many milliseconds before connecting again.
   */
  constructor(host, port, options) {
    super();

    options = options || {};

    this.host = host || 'localhost';
    this.port = port || 8321;

    this.clientSocket = null;
    this.connected = false;

    // Requests that have not yet been written to the socket. Typically
    // empty unless disconnected.
    this.requestQueue = [];

    // Requests that have been written to the socket and are awaiting a
    // response.
    this.responseQueue = [];

    this.autoReconnect = defaultIfUndefined(options.autoReconnect, true);
    this.maxReconnectAttempts = defaultIfUndefined(options.maxReconnectAttempts, 5);
    this.throttleConnect = defaultIfUndefined(options.throttleConnect, true);
    this.throttleConnectTimeoutMillis = defaultIfUndefined(
      options.throttleConnectTimeoutMillis, 1000);
    this.maxPendingRequests = defaultIfUndefined(options.maxPendingRequests, 100);
    this.defaultCommandTimeoutMillis = defaultIfUndefined(
      options.defaultCommandTimeoutMillis, 1000);

    // Timeout handle, set when the client is unexpectedly closed.
    this.connectTimeoutHandle = null;
    this.lastDisconnectDate = null;
    this.reconnectAttempts = 0;
    this.onDisconnectedListener = this._onUnexpectedDisconnect.bind(this);
  }

  /** Schedules connection to the server; no-op if already connected. */
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

  /** Manually close the connection. This will not trigger a reconnect. */
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
   * Upon success, the promise is resolve with an object containing
   * fields `isAllowed` (boolean), `currentCredit`, and
   * `nextResetSeconds`.
   *
   * @param  {object} operation the operation object, consisting of string key-value pairs
   *                            (optional, default: `{}`)
   * @param  {number} timeout   the timeout in millis; if undefined, uses instance
   *                            default timeout.
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

  /** Returns total number of outstanding requests. */
  _numPendingRequests() {
    // When connected, the requestQueue will typically be near-empty
    // (commands are flushed quickly) and the responseQueue will match
    // the arrival rate.
    //
    // When disconnected, the requestQueue will fill up and the responseQueue
    // will be empty (no writes to socket until connected).
    return this.requestQueue.length + this.responseQueue.length;
  }

  _doConnect() {
    this.connectTimeoutHandle = null;
    this.clientSocket = new net.Socket();

    this.clientSocket.connect(this.port, this.host, this._onConnected.bind(this));
    this.clientSocket.on('close', this.onDisconnectedListener);
    this.clientSocket.on('error', (err) => {
      this.emit('error', err);
    });
  }

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

  /** Do cleanup needed with every disconnect. */
  _doDisconnect() {
    this.connected = false;
    this.clientSocket = null;
    this._rejectAllPending();
    this.emit('disconnected');
  }

  _onUnexpectedDisconnect() {
    this.lastDisconnectDate = new Date();
    this._doDisconnect();
    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.connect();
    }
  }

  /** Immediately rejects all requests, whether or not they have been sent. */
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
   * Parses a protocol response.
   * @param  {[type]} line [description]
   * @return {[type]}      [description]
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
 * Stub of the public interface.
 */
Client.Stub = class DivvyClientStub extends Client {
  connect() {
  }

  close() {
  }

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
