'use strict';

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _regenerator = _interopRequireDefault(require("@babel/runtime/regenerator"));

var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));

var _toConsumableArray2 = _interopRequireDefault(require("@babel/runtime/helpers/toConsumableArray"));

var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));

var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));

var _possibleConstructorReturn2 = _interopRequireDefault(require("@babel/runtime/helpers/possibleConstructorReturn"));

var _getPrototypeOf2 = _interopRequireDefault(require("@babel/runtime/helpers/getPrototypeOf"));

var _inherits2 = _interopRequireDefault(require("@babel/runtime/helpers/inherits"));

var pMap = require('p-map');

var GSet = require('./g-set');

var Entry = require('./entry');

var LogIO = require('./log-io');

var LogError = require('./log-errors');

var Clock = require('./lamport-clock');

var _require = require('./log-sorting'),
    LastWriteWins = _require.LastWriteWins,
    NoZeroes = _require.NoZeroes;

var AccessController = require('./default-access-controller');

var _require2 = require('./utils'),
    isDefined = _require2.isDefined,
    findUniques = _require2.findUniques;

var randomId = function randomId() {
  return new Date().getTime().toString();
};

var getCid = function getCid(e) {
  return e.cid;
};

var flatMap = function flatMap(res, acc) {
  return res.concat(acc);
};

var getNextPointers = function getNextPointers(entry) {
  return entry.next;
};

var maxClockTimeReducer = function maxClockTimeReducer(res, acc) {
  return Math.max(res, acc.clock.time);
};

var uniqueEntriesReducer = function uniqueEntriesReducer(res, acc) {
  res[acc.cid] = acc;
  return res;
};
/**
 * Log.
 *
 * @description
 * Log implements a G-Set CRDT and adds ordering.
 *
 * From:
 * "A comprehensive study of Convergent and Commutative Replicated Data Types"
 * https://hal.inria.fr/inria-00555588
 */


var Log =
/*#__PURE__*/
function (_GSet) {
  (0, _inherits2.default)(Log, _GSet);

  /**
   * Create a new Log instance
   * @param {IPFS} ipfs An IPFS instance
   * @param {Object} access AccessController (./default-access-controller)
   * @param {Object} identity Identity (https://github.com/orbitdb/orbit-db-identity-provider/blob/master/src/identity.js)
   * @param {Array<Entry>} [entries] An Array of Entries from which to create the log
   * @param {string} [logId] ID of the log
   * @param {Array<Entry>} [heads] Set the heads of the log
   * @param {Clock} [clock] Set the clock of the log
   * @param {Function} [sortFn] The sort function - by default LastWriteWins
   * @return {Log} The log instance
   */
  function Log(ipfs, access, identity, logId, entries, heads, clock, sortFn) {
    var _this;

    (0, _classCallCheck2.default)(this, Log);

    if (!isDefined(ipfs)) {
      throw LogError.IPFSNotDefinedError();
    }

    if (!isDefined(access)) {
      throw new Error('Access controller is required');
    }

    if (!isDefined(identity)) {
      throw new Error('Identity is required');
    }

    if (isDefined(entries) && !Array.isArray(entries)) {
      throw new Error("'entries' argument must be an array of Entry instances");
    }

    if (isDefined(heads) && !Array.isArray(heads)) {
      throw new Error("'heads' argument must be an array");
    }

    if (!isDefined(sortFn)) {
      sortFn = LastWriteWins;
    }

    _this = (0, _possibleConstructorReturn2.default)(this, (0, _getPrototypeOf2.default)(Log).call(this));
    _this._sortFn = NoZeroes(sortFn);
    _this._storage = ipfs;
    _this._id = logId || randomId(); // Access Controller

    _this._access = access; // Identity

    _this._identity = identity; // Add entries to the internal cache

    entries = entries || [];
    _this._entryIndex = entries.reduce(uniqueEntriesReducer, {}); // Set heads if not passed as an argument

    heads = heads || Log.findHeads(entries);
    _this._headsIndex = heads.reduce(uniqueEntriesReducer, {}); // Index of all next pointers in this log

    _this._nextsIndex = {};

    var addToNextsIndex = function addToNextsIndex(e) {
      return e.next.forEach(function (a) {
        return _this._nextsIndex[a] = e.cid;
      });
    };

    entries.forEach(addToNextsIndex); // Set the length, we calculate the length manually internally

    _this._length = entries.length; // Set the clock

    var maxTime = Math.max(clock ? clock.time : 0, _this.heads.reduce(maxClockTimeReducer, 0)); // Take the given key as the clock id is it's a Key instance,
    // otherwise if key was given, take whatever it is,
    // and if it was null, take the given id as the clock id

    _this._clock = new Clock(_this._identity.publicKey, maxTime);
    return _this;
  }
  /**
   * Returns the ID of the log.
   * @returns {string}
   */


  (0, _createClass2.default)(Log, [{
    key: "get",

    /**
     * Find an entry.
     * @param {string} [cid] The CID of the entry
     * @returns {Entry|undefined}
     */
    value: function get(cid) {
      return this._entryIndex[cid];
    }
    /**
     * Checks if a entry is part of the log
     * @param {string} cid The CID of the entry
     * @returns {boolean}
     */

  }, {
    key: "has",
    value: function has(entry) {
      return this._entryIndex[entry.cid || entry] !== undefined;
    }
  }, {
    key: "traverse",
    value: function traverse(rootEntries) {
      var _this2 = this;

      var amount = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : -1;
      // Sort the given given root entries and use as the starting stack
      var stack = rootEntries.sort(this._sortFn).reverse(); // Cache for checking if we've processed an entry already

      var traversed = {}; // End result

      var result = {}; // We keep a counter to check if we have traversed requested amount of entries

      var count = 0; // Named function for getting an entry from the log

      var getEntry = function getEntry(e) {
        return _this2.get(e);
      }; // Add an entry to the stack and traversed nodes index


      var addToStack = function addToStack(entry) {
        // If we've already processed the entry, don't add it to the stack
        if (!entry || traversed[entry.cid]) {
          return;
        } // Add the entry in front of the stack and sort


        stack = [entry].concat((0, _toConsumableArray2.default)(stack)).sort(_this2._sortFn).reverse(); // Add to the cache of processed entries

        traversed[entry.cid] = true;
      }; // Start traversal
      // Process stack until it's empty (traversed the full log)
      // or when we have the requested amount of entries
      // If requested entry amount is -1, traverse all


      while (stack.length > 0 && (amount === -1 || count < amount)) {
        // eslint-disable-line no-unmodified-loop-condition
        // Get the next element from the stack
        var entry = stack.shift(); // Add to the result

        count++;
        result[entry.cid] = entry; // Add entry's next references to the stack

        entry.next.map(getEntry).filter(isDefined).forEach(addToStack);
      }

      return result;
    }
    /**
     * Append an entry to the log.
     * @param {Entry} entry Entry to add
     * @return {Log} New Log containing the appended value
     */

  }, {
    key: "append",
    value: function () {
      var _append = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee(data) {
        var _this3 = this;

        var pointerCount,
            newTime,
            references,
            nexts,
            entry,
            canAppend,
            _args = arguments;
        return _regenerator.default.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                pointerCount = _args.length > 1 && _args[1] !== undefined ? _args[1] : 1;
                // Update the clock (find the latest clock)
                newTime = Math.max(this.clock.time, this.heads.reduce(maxClockTimeReducer, 0)) + 1;
                this._clock = new Clock(this.clock.id, newTime); // Get the required amount of cids to next entries (as per current state of the log)

                references = this.traverse(this.heads, Math.max(pointerCount, this.heads.length));
                nexts = Object.keys(Object.assign({}, this._headsIndex, references)); // @TODO: Split Entry.create into creating object, checking permission, signing and then posting to IPFS
                // Create the entry and add it to the internal cache

                _context.next = 7;
                return Entry.create(this._storage, this._identity, this.id, data, nexts, this.clock);

              case 7:
                entry = _context.sent;
                _context.next = 10;
                return this._access.canAppend(entry, this._identity.provider);

              case 10:
                canAppend = _context.sent;

                if (canAppend) {
                  _context.next = 13;
                  break;
                }

                throw new Error("Could not append entry, key \"".concat(this._identity.id, "\" is not allowed to write to the log"));

              case 13:
                this._entryIndex[entry.cid] = entry;
                nexts.forEach(function (e) {
                  return _this3._nextsIndex[e] = entry.cid;
                });
                this._headsIndex = {};
                this._headsIndex[entry.cid] = entry; // Update the length

                this._length++;
                return _context.abrupt("return", entry);

              case 19:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this);
      }));

      function append(_x) {
        return _append.apply(this, arguments);
      }

      return append;
    }()
    /**
     * Join two logs.
     *
     * Joins another log into this one.
     *
     * @param {Log} log Log to join with this Log
     * @param {number} [size=-1] Max size of the joined log
     * @returns {Promise<Log>} This Log instance
     * @example
     * await log1.join(log2)
     */

  }, {
    key: "join",
    value: function () {
      var _join = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee4(log) {
        var _this4 = this;

        var size,
            newItems,
            identityProvider,
            permitted,
            verify,
            entriesToJoin,
            addToNextsIndex,
            notReferencedByNewItems,
            notInCurrentNexts,
            nextsFromNewItems,
            mergedHeads,
            tmp,
            maxClock,
            _args4 = arguments;
        return _regenerator.default.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                size = _args4.length > 1 && _args4[1] !== undefined ? _args4[1] : -1;

                if (isDefined(log)) {
                  _context4.next = 3;
                  break;
                }

                throw LogError.LogNotDefinedError();

              case 3:
                if (Log.isLog(log)) {
                  _context4.next = 5;
                  break;
                }

                throw LogError.NotALogError();

              case 5:
                if (!(this.id !== log.id)) {
                  _context4.next = 7;
                  break;
                }

                return _context4.abrupt("return");

              case 7:
                // Get the difference of the logs
                newItems = Log.difference(log, this);
                identityProvider = this._identity.provider; // Verify if entries are allowed to be added to the log and throws if
                // there's an invalid entry

                permitted =
                /*#__PURE__*/
                function () {
                  var _ref = (0, _asyncToGenerator2.default)(
                  /*#__PURE__*/
                  _regenerator.default.mark(function _callee2(entry) {
                    var canAppend;
                    return _regenerator.default.wrap(function _callee2$(_context2) {
                      while (1) {
                        switch (_context2.prev = _context2.next) {
                          case 0:
                            _context2.next = 2;
                            return _this4._access.canAppend(entry, identityProvider);

                          case 2:
                            canAppend = _context2.sent;

                            if (canAppend) {
                              _context2.next = 5;
                              break;
                            }

                            throw new Error("Could not append entry, key \"".concat(entry.identity.id, "\" is not allowed to write to the log"));

                          case 5:
                          case "end":
                            return _context2.stop();
                        }
                      }
                    }, _callee2, this);
                  }));

                  return function permitted(_x3) {
                    return _ref.apply(this, arguments);
                  };
                }(); // Verify signature for each entry and throws if there's an invalid signature


                verify =
                /*#__PURE__*/
                function () {
                  var _ref2 = (0, _asyncToGenerator2.default)(
                  /*#__PURE__*/
                  _regenerator.default.mark(function _callee3(entry) {
                    var isValid, publicKey;
                    return _regenerator.default.wrap(function _callee3$(_context3) {
                      while (1) {
                        switch (_context3.prev = _context3.next) {
                          case 0:
                            _context3.next = 2;
                            return Entry.verify(identityProvider, entry);

                          case 2:
                            isValid = _context3.sent;
                            publicKey = entry.identity ? entry.identity.publicKey : entry.key;

                            if (isValid) {
                              _context3.next = 6;
                              break;
                            }

                            throw new Error("Could not validate signature \"".concat(entry.sig, "\" for entry \"").concat(entry.cid, "\" and key \"").concat(publicKey, "\""));

                          case 6:
                          case "end":
                            return _context3.stop();
                        }
                      }
                    }, _callee3, this);
                  }));

                  return function verify(_x4) {
                    return _ref2.apply(this, arguments);
                  };
                }();

                entriesToJoin = Object.values(newItems);
                _context4.next = 14;
                return pMap(entriesToJoin, permitted, {
                  concurrency: 1
                });

              case 14:
                _context4.next = 16;
                return pMap(entriesToJoin, verify, {
                  concurrency: 1
                });

              case 16:
                // Update the internal next pointers index
                addToNextsIndex = function addToNextsIndex(e) {
                  var entry = _this4.get(e.cid);

                  if (!entry) _this4._length++;
                  /* istanbul ignore else */

                  e.next.forEach(function (a) {
                    return _this4._nextsIndex[a] = e.cid;
                  });
                };

                Object.values(newItems).forEach(addToNextsIndex); // Update the internal entry index

                this._entryIndex = Object.assign(this._entryIndex, newItems); // Merge the heads

                notReferencedByNewItems = function notReferencedByNewItems(e) {
                  return !nextsFromNewItems.find(function (a) {
                    return a === e.cid;
                  });
                };

                notInCurrentNexts = function notInCurrentNexts(e) {
                  return !_this4._nextsIndex[e.cid];
                };

                nextsFromNewItems = Object.values(newItems).map(getNextPointers).reduce(flatMap, []);
                mergedHeads = Log.findHeads(Object.values(Object.assign({}, this._headsIndex, log._headsIndex))).filter(notReferencedByNewItems).filter(notInCurrentNexts).reduce(uniqueEntriesReducer, {});
                this._headsIndex = mergedHeads; // Slice to the requested size

                if (size > -1) {
                  tmp = this.values;
                  tmp = tmp.slice(-size);
                  this._entryIndex = tmp.reduce(uniqueEntriesReducer, {});
                  this._headsIndex = Log.findHeads(tmp);
                  this._length = Object.values(this._entryIndex).length;
                } // Find the latest clock from the heads


                maxClock = Object.values(this._headsIndex).reduce(maxClockTimeReducer, 0);
                this._clock = new Clock(this.clock.id, Math.max(this.clock.time, maxClock));
                return _context4.abrupt("return", this);

              case 28:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4, this);
      }));

      function join(_x2) {
        return _join.apply(this, arguments);
      }

      return join;
    }()
    /**
     * Get the log in JSON format.
     * @returns {Object} An object with the id and heads properties
     */

  }, {
    key: "toJSON",
    value: function toJSON() {
      return {
        id: this.id,
        heads: this.heads.sort(this._sortFn) // default sorting
        .reverse() // we want the latest as the first element
        .map(getCid) // return only the head cids

      };
    }
    /**
     * Get the log in JSON format as a snapshot.
     * @returns {Object} An object with the id, heads and value properties
     */

  }, {
    key: "toSnapshot",
    value: function toSnapshot() {
      return {
        id: this.id,
        heads: this.heads,
        values: this.values
      };
    }
    /**
     * Get the log as a Buffer.
     * @returns {Buffer}
     */

  }, {
    key: "toBuffer",
    value: function toBuffer() {
      return Buffer.from(JSON.stringify(this.toJSON()));
    }
    /**
     * Returns the log entries as a formatted string.
     * @returns {string}
     * @example
     * two
     * └─one
     *   └─three
     */

  }, {
    key: "toString",
    value: function toString(payloadMapper) {
      var _this5 = this;

      return this.values.slice().reverse().map(function (e, idx) {
        var parents = Entry.findChildren(e, _this5.values);
        var len = parents.length;
        var padding = new Array(Math.max(len - 1, 0));
        padding = len > 1 ? padding.fill('  ') : padding;
        padding = len > 0 ? padding.concat(['└─']) : padding;
        /* istanbul ignore next */

        return padding.join('') + (payloadMapper ? payloadMapper(e.payload) : e.payload);
      }).join('\n');
    }
    /**
     * Check whether an object is a Log instance.
     * @param {Object} log An object to check
     * @returns {boolean}
     */

  }, {
    key: "toCID",

    /**
     * Get the log's CID.
     * @returns {Promise<string>} The Log CID
     */
    value: function toCID() {
      return LogIO.toCID(this._storage, this);
    }
    /**
     * Get the log's multihash.
     * @returns {Promise<string>} Multihash of the Log as Base58 encoded string
     * @deprecated
     */

  }, {
    key: "toMultihash",
    value: function toMultihash() {
      return LogIO.toMultihash(this._storage, this);
    }
    /**
     * Create a log from a CID.
     * @param {IPFS} ipfs An IPFS instance
     * @param {AccessController} access The access controller instance
     * @param {Identity} identity The identity instance
     * @param {string} cid The log CID
     * @param {number} [length=-1] How many items to include in the log
     * @param {Array<Entry>} [exclude] Entries to not fetch (cached)
     * @param {function(cid, entry, parent, depth)} onProgressCallback
     * @returns {Promise<Log>}
     * @deprecated
     */

  }, {
    key: "id",
    get: function get() {
      return this._id;
    }
    /**
     * Returns the clock of the log.
     * @returns {string}
     */

  }, {
    key: "clock",
    get: function get() {
      return this._clock;
    }
    /**
     * Returns the length of the log.
     * @return {number} Length
     */

  }, {
    key: "length",
    get: function get() {
      return this._length;
    }
    /**
     * Returns the values in the log.
     * @returns {Array<Entry>}
     */

  }, {
    key: "values",
    get: function get() {
      return Object.values(this.traverse(this.heads)).reverse();
    }
    /**
     * Returns an array of heads as cids.
     * @returns {Array<string>}
     */

  }, {
    key: "heads",
    get: function get() {
      return Object.values(this._headsIndex).sort(this._sortFn).reverse();
    }
    /**
     * Returns an array of Entry objects that reference entries which
     * are not in the log currently.
     * @returns {Array<Entry>}
     */

  }, {
    key: "tails",
    get: function get() {
      return Log.findTails(this.values);
    }
    /**
     * Returns an array of cids that are referenced by entries which
     * are not in the log currently.
     * @returns {Array<string>} Array of CIDs
     */

  }, {
    key: "tailCids",
    get: function get() {
      return Log.findTailCids(this.values);
    }
  }], [{
    key: "isLog",
    value: function isLog(log) {
      return log.id !== undefined && log.heads !== undefined && log._entryIndex !== undefined;
    }
  }, {
    key: "fromCID",
    value: function () {
      var _fromCID = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee5(ipfs, access, identity, cid) {
        var length,
            exclude,
            onProgressCallback,
            data,
            _args5 = arguments;
        return _regenerator.default.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                length = _args5.length > 4 && _args5[4] !== undefined ? _args5[4] : -1;
                exclude = _args5.length > 5 ? _args5[5] : undefined;
                onProgressCallback = _args5.length > 6 ? _args5[6] : undefined;
                _context5.next = 5;
                return LogIO.fromCID(ipfs, cid, length, exclude, onProgressCallback);

              case 5:
                data = _context5.sent;
                return _context5.abrupt("return", new Log(ipfs, access, identity, data.id, data.values, data.heads, data.clock));

              case 7:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this);
      }));

      function fromCID(_x5, _x6, _x7, _x8) {
        return _fromCID.apply(this, arguments);
      }

      return fromCID;
    }()
    /**
      * Create a log from a multihash.
      * @param {IPFS} ipfs An IPFS instance
      * @param {AccessController} access The access controller instance
      * @param {Identity} identity The identity instance
      * @param {string} multihash Multihash (as a Base58 encoded string) to create the Log from
      * @param {number} [length=-1] How many items to include in the log
      * @param {Array<Entry>} [exclude] Entries to not fetch (cached)
      * @param {function(cid, entry, parent, depth)} onProgressCallback
      * @returns {Promise<Log>}
      * @deprecated
      */

  }, {
    key: "fromMultihash",
    value: function () {
      var _fromMultihash = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee6(ipfs, access, identity, multihash) {
        var length,
            exclude,
            onProgressCallback,
            _args6 = arguments;
        return _regenerator.default.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                length = _args6.length > 4 && _args6[4] !== undefined ? _args6[4] : -1;
                exclude = _args6.length > 5 ? _args6[5] : undefined;
                onProgressCallback = _args6.length > 6 ? _args6[6] : undefined;
                return _context6.abrupt("return", Log.fromCID(ipfs, access, identity, multihash, length, exclude, onProgressCallback));

              case 4:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this);
      }));

      function fromMultihash(_x9, _x10, _x11, _x12) {
        return _fromMultihash.apply(this, arguments);
      }

      return fromMultihash;
    }()
    /**
     * Create a log from a single entry's CID.
     * @param {IPFS} ipfs An IPFS instance
     * @param {AccessController} access The access controller instance
     * @param {Identity} identity The identity instance
     * @param {string} cid The entry's CID
     * @param {string} [logId] The ID of the log
     * @param {number} [length=-1] How many entries to include in the log
     * @param {function(cid, entry, parent, depth)} onProgressCallback
     * @return {Promise<Log>} New Log
     */

  }, {
    key: "fromEntryCid",
    value: function () {
      var _fromEntryCid = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee7(ipfs, access, identity, cid, logId) {
        var length,
            exclude,
            onProgressCallback,
            data,
            _args7 = arguments;
        return _regenerator.default.wrap(function _callee7$(_context7) {
          while (1) {
            switch (_context7.prev = _context7.next) {
              case 0:
                length = _args7.length > 5 && _args7[5] !== undefined ? _args7[5] : -1;
                exclude = _args7.length > 6 ? _args7[6] : undefined;
                onProgressCallback = _args7.length > 7 ? _args7[7] : undefined;
                _context7.next = 5;
                return LogIO.fromEntryCid(ipfs, cid, length, exclude, onProgressCallback);

              case 5:
                data = _context7.sent;
                return _context7.abrupt("return", new Log(ipfs, access, identity, logId, data.values));

              case 7:
              case "end":
                return _context7.stop();
            }
          }
        }, _callee7, this);
      }));

      function fromEntryCid(_x13, _x14, _x15, _x16, _x17) {
        return _fromEntryCid.apply(this, arguments);
      }

      return fromEntryCid;
    }()
    /**
     * Create a log from a single entry's multihash.
     * @param {IPFS} ipfs An IPFS instance
     * @param {AccessController} access The access controller instance
     * @param {Identity} identity The identity instance
     * @param {string} multihash The entry's multihash
     * @param {string} [logId] The ID of the log
     * @param {number} [length=-1] How many entries to include in the log
     * @param {function(cid, entry, parent, depth)} onProgressCallback
     * @return {Promise<Log>} New Log
     * @deprecated
     */

  }, {
    key: "fromEntryHash",
    value: function () {
      var _fromEntryHash = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee8(ipfs, access, identity, multihash, logId) {
        var length,
            exclude,
            onProgressCallback,
            _args8 = arguments;
        return _regenerator.default.wrap(function _callee8$(_context8) {
          while (1) {
            switch (_context8.prev = _context8.next) {
              case 0:
                length = _args8.length > 5 && _args8[5] !== undefined ? _args8[5] : -1;
                exclude = _args8.length > 6 ? _args8[6] : undefined;
                onProgressCallback = _args8.length > 7 ? _args8[7] : undefined;
                return _context8.abrupt("return", Log.fromEntryCid(ipfs, access, identity, multihash, logId, length, exclude, onProgressCallback));

              case 4:
              case "end":
                return _context8.stop();
            }
          }
        }, _callee8, this);
      }));

      function fromEntryHash(_x18, _x19, _x20, _x21, _x22) {
        return _fromEntryHash.apply(this, arguments);
      }

      return fromEntryHash;
    }()
    /**
     * Create a log from a Log Snapshot JSON.
     * @param {IPFS} ipfs An IPFS instance
     * @param {AccessController} access The access controller instance
     * @param {Identity} identity The identity instance
     * @param {Object} json Log snapshot as JSON object
     * @param {number} [length=-1] How many entries to include in the log
     * @param {function(cid, entry, parent, depth)} [onProgressCallback]
     * @return {Promise<Log>} New Log
     */

  }, {
    key: "fromJSON",
    value: function () {
      var _fromJSON = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee9(ipfs, access, identity, json) {
        var length,
            timeout,
            onProgressCallback,
            data,
            _args9 = arguments;
        return _regenerator.default.wrap(function _callee9$(_context9) {
          while (1) {
            switch (_context9.prev = _context9.next) {
              case 0:
                length = _args9.length > 4 && _args9[4] !== undefined ? _args9[4] : -1;
                timeout = _args9.length > 5 ? _args9[5] : undefined;
                onProgressCallback = _args9.length > 6 ? _args9[6] : undefined;
                _context9.next = 5;
                return LogIO.fromJSON(ipfs, json, length, timeout, onProgressCallback);

              case 5:
                data = _context9.sent;
                return _context9.abrupt("return", new Log(ipfs, access, identity, data.id, data.values));

              case 7:
              case "end":
                return _context9.stop();
            }
          }
        }, _callee9, this);
      }));

      function fromJSON(_x23, _x24, _x25, _x26) {
        return _fromJSON.apply(this, arguments);
      }

      return fromJSON;
    }()
    /**
     * Create a new log from an Entry instance.
     * @param {IPFS} ipfs An IPFS instance
     * @param {Entry|Array<Entry>} sourceEntries An Entry or an array of entries to fetch a log from
     * @param {number} [length=-1] How many entries to include. Default: infinite.
     * @param {Array<Entry>} [exclude] Entries to not fetch (cached)
     * @param {function(cid, entry, parent, depth)} [onProgressCallback]
     * @return {Promise<Log>} New Log
     */

  }, {
    key: "fromEntry",
    value: function () {
      var _fromEntry = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee10(ipfs, access, identity, sourceEntries) {
        var length,
            exclude,
            onProgressCallback,
            data,
            _args10 = arguments;
        return _regenerator.default.wrap(function _callee10$(_context10) {
          while (1) {
            switch (_context10.prev = _context10.next) {
              case 0:
                length = _args10.length > 4 && _args10[4] !== undefined ? _args10[4] : -1;
                exclude = _args10.length > 5 ? _args10[5] : undefined;
                onProgressCallback = _args10.length > 6 ? _args10[6] : undefined;
                _context10.next = 5;
                return LogIO.fromEntry(ipfs, sourceEntries, length, exclude, onProgressCallback);

              case 5:
                data = _context10.sent;
                return _context10.abrupt("return", new Log(ipfs, access, identity, data.id, data.values));

              case 7:
              case "end":
                return _context10.stop();
            }
          }
        }, _callee10, this);
      }));

      function fromEntry(_x27, _x28, _x29, _x30) {
        return _fromEntry.apply(this, arguments);
      }

      return fromEntry;
    }()
    /**
     * Find heads from a collection of entries.
     *
     * Finds entries that are the heads of this collection,
     * ie. entries that are not referenced by other entries.
     *
     * @param {Array<Entry>} entries Entries to search heads from
     * @returns {Array<Entry>}
     */

  }, {
    key: "findHeads",
    value: function findHeads(entries) {
      var indexReducer = function indexReducer(res, entry, idx, arr) {
        var addToResult = function addToResult(e) {
          return res[e] = entry.cid;
        };

        entry.next.forEach(addToResult);
        return res;
      };

      var items = entries.reduce(indexReducer, {});

      var exists = function exists(e) {
        return items[e.cid] === undefined;
      };

      var compareIds = function compareIds(a, b) {
        return a.clock.id > b.clock.id;
      };

      return entries.filter(exists).sort(compareIds);
    } // Find entries that point to another entry that is not in the
    // input array

  }, {
    key: "findTails",
    value: function findTails(entries) {
      // Reverse index { next -> entry }
      var reverseIndex = {}; // Null index containing entries that have no parents (nexts)

      var nullIndex = []; // CIDs for all entries for quick lookups

      var cids = {}; // CIDs of all next entries

      var nexts = [];

      var addToIndex = function addToIndex(e) {
        if (e.next.length === 0) {
          nullIndex.push(e);
        }

        var addToReverseIndex = function addToReverseIndex(a) {
          /* istanbul ignore else */
          if (!reverseIndex[a]) reverseIndex[a] = [];
          reverseIndex[a].push(e);
        }; // Add all entries and their parents to the reverse index


        e.next.forEach(addToReverseIndex); // Get all next references

        nexts = nexts.concat(e.next); // Get the cids of input entries

        cids[e.cid] = true;
      }; // Create our indices


      entries.forEach(addToIndex);

      var addUniques = function addUniques(res, entries, idx, arr) {
        return res.concat(findUniques(entries, 'cid'));
      };

      var exists = function exists(e) {
        return cids[e] === undefined;
      };

      var findFromReverseIndex = function findFromReverseIndex(e) {
        return reverseIndex[e];
      }; // Drop cids that are not in the input entries


      var tails = nexts // For every cid in nexts:
      .filter(exists) // Remove undefineds and nulls
      .map(findFromReverseIndex) // Get the Entry from the reverse index
      .reduce(addUniques, []) // Flatten the result and take only uniques
      .concat(nullIndex); // Combine with tails the have no next refs (ie. first-in-their-chain)

      return findUniques(tails, 'cid').sort(Entry.compare);
    } // Find the cids to entries that are not in a collection
    // but referenced by other entries

  }, {
    key: "findTailCids",
    value: function findTailCids(entries) {
      var cids = {};

      var addToIndex = function addToIndex(e) {
        return cids[e.cid] = true;
      };

      var reduceTailCids = function reduceTailCids(res, entry, idx, arr) {
        var addToResult = function addToResult(e) {
          /* istanbul ignore else */
          if (cids[e] === undefined) {
            res.splice(0, 0, e);
          }
        };

        entry.next.reverse().forEach(addToResult);
        return res;
      };

      entries.forEach(addToIndex);
      return entries.reduce(reduceTailCids, []);
    }
  }, {
    key: "difference",
    value: function difference(a, b) {
      var stack = Object.keys(a._headsIndex);
      var traversed = {};
      var res = {};

      var pushToStack = function pushToStack(cid) {
        if (!traversed[cid] && !b.get(cid)) {
          stack.push(cid);
          traversed[cid] = true;
        }
      };

      while (stack.length > 0) {
        var cid = stack.shift();
        var entry = a.get(cid);

        if (entry && !b.get(cid) && entry.id === b.id) {
          res[entry.cid] = entry;
          traversed[entry.cid] = true;
          entry.next.forEach(pushToStack);
        }
      }

      return res;
    }
  }]);
  return Log;
}(GSet);

module.exports = Log;
module.exports.AccessController = AccessController;