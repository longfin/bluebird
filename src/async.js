"use strict";
var firstLineError;
try {throw new Error(); } catch (e) {firstLineError = e;}
var ASSERT = require("./assert.js");
var schedule = require("./schedule.js");
var Queue = require("./queue.js");
var _process = typeof process !== "undefined" ? process : undefined;
var util = require("./util.js");

function Async() {
    this._isTickUsed = false;
    this._lateQueue = new Queue(LATE_QUEUE_CAPACITY);
    this._normalQueue = new Queue(NORMAL_QUEUE_CAPACITY);
    this._trampolineEnabled = true;
    var self = this;
    this.drainQueues = function () {
        self._drainQueues();
    };
    this._schedule =
        schedule.isStatic ? schedule(this.drainQueues) : schedule;
}

Async.prototype.disableTrampolineIfNecessary = function() {
    if (util.hasDevTools) {
        this._trampolineEnabled = false;
    }
};

Async.prototype.haveItemsQueued = function () {
    return this._normalQueue.length() > 0;
};

Async.prototype._withDomain = function(fn) {
    ASSERT(typeof fn === "function");
    if (_process !== undefined &&
        _process.domain != null &&
        !fn.domain) {
        fn = _process.domain.bind(fn);
    }
    return fn;
};

// Must be used if fn can throw
Async.prototype.throwLater = function(fn, arg) {
    if (arguments.length === 1) {
        arg = fn;
        fn = function () { throw arg; };
    }
    fn = this._withDomain(fn);
    if (typeof setTimeout !== "undefined") {
        setTimeout(function() {
            fn(arg);
        }, 0);
    } else try {
        this._schedule(function() {
            fn(arg);
        });
    } catch (e) {
        throw new Error(NO_ASYNC_SCHEDULER);
    }
};

//When the fn absolutely needs to be called after
//the queue has been completely flushed
function AsyncInvokeLater(fn, receiver, arg) {
    ASSERT(arguments.length === 3);
    fn = this._withDomain(fn);
    this._lateQueue.push(fn, receiver, arg);
    this._queueTick();
}

function AsyncInvoke(fn, receiver, arg) {
    ASSERT(arguments.length === 3);
    fn = this._withDomain(fn);
    this._normalQueue.push(fn, receiver, arg);
    this._queueTick();
}

function AsyncSettlePromises(promise) {
    this._normalQueue._pushOne(promise);
    this._queueTick();
}

if (!util.hasDevTools) {
    Async.prototype.invokeLater = AsyncInvokeLater;
    Async.prototype.invoke = AsyncInvoke;
    Async.prototype.settlePromises = AsyncSettlePromises;
} else {
    Async.prototype.invokeLater = function (fn, receiver, arg) {
        if (this._trampolineEnabled) {
            AsyncInvokeLater(fn, receiver, arg);
        } else {
            setTimeout(function() {
                fn.call(receiver, arg);
            }, 100);
        }
    };

    Async.prototype.invoke = function (fn, receiver, arg) {
        if (this._trampolineEnabled) {
            AsyncInvoke(fn, receiver, arg);
        } else {
            setTimeout(function() {
                fn.call(receiver, arg);
            }, 0);
        }
    };

    Async.prototype.settlePromises = function(promise) {
        if (this._trampolineEnabled) {
            AsyncSettlePromises(promise);
        } else {
            setTimeout(function() {
                promise._settlePromises();
            }, 0);
        }
    };
}

Async.prototype.invokeFirst = function (fn, receiver, arg) {
    ASSERT(arguments.length === 3);
    fn = this._withDomain(fn);
    this._normalQueue.unshift(fn, receiver, arg);
    this._queueTick();
};

Async.prototype._drainQueue = function(queue) {
    while (queue.length() > 0) {
        var fn = queue.shift();
        if (typeof fn !== "function") {
            fn._settlePromises();
            continue;
        }
        var receiver = queue.shift();
        var arg = queue.shift();
        fn.call(receiver, arg);
    }
};

Async.prototype._drainQueues = function () {
    ASSERT(this._isTickUsed);
    this._drainQueue(this._normalQueue);
    this._reset();
    this._drainQueue(this._lateQueue);
};

Async.prototype._queueTick = function () {
    if (!this._isTickUsed) {
        this._isTickUsed = true;
        this._schedule(this.drainQueues);
    }
};

Async.prototype._reset = function () {
    this._isTickUsed = false;
};

module.exports = new Async();
module.exports.firstLineError = firstLineError;
