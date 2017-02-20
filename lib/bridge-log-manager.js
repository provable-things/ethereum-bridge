'use strict'

const singleton = require('pragma-singleton')
const bridgeCore = require('./bridge-core')
const OracleInstance = bridgeCore.OracleInstance
const asyncLoop = require('node-async-loop')
const EventEmitter = require('events')

const LogEmitter = new EventEmitter()

function BridgeLogManager () {
  this.contractInstance = OracleInstance().getContractInstance()
}

BridgeLogManager.prototype.watchEvents = function () {
  // watch all connector events
  try {
    this.contractInstance.Log1({'fromBlock': 'latest', 'toBlock': 'latest'}, this.emitsNewLog)

    this.contractInstance.Log2({'fromBlock': 'latest', 'toBlock': 'latest'}, this.emitsNewLog)

    this.contractInstance.LogN({'fromBlock': 'latest', 'toBlock': 'latest'}, this.emitsNewLog)
  } catch (err) {
    this.emitsNewLog(err, null)
  }
}

BridgeLogManager.prototype.fetchLogsByBlock = function (fromBlock, toBlock) {
  try {
    var log1e = this.contractInstance.Log1({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    log1e.get(function (err, data) {
      if (err) this.emitsNewLog(err, null)
      else {
        if (fromBlock !== 'latest' && toBlock !== 'latest') log1e.stopWatching()
        if (typeof data !== 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            this.emitsNewLog(null, log)
            next(null)
          }, 1000)
        }, function (err) {
          if (err) return this.emitsNewLog(err, null)
        })
      }
    })

    var log2e = this.contractInstance.Log2({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    log2e.get(function (err, data) {
      if (err) this.emitsNewLog(err, null)
      else {
        if (fromBlock !== 'latest' && toBlock !== 'latest') log1e.stopWatching()
        if (typeof data !== 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            this.emitsNewLog(null, log)
            next(null)
          }, 1000)
        }, function (err) {
          if (err) return this.emitsNewLog(err, null)
        })
      }
    })

    var logNe = this.contractInstance.LogN({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    logNe.get(function (err, data) {
      if (err) this.emitsNewLog(err, null)
      else {
        if (fromBlock !== 'latest' && toBlock !== 'latest') log1e.stopWatching()
        if (typeof data !== 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            this.emitsNewLog(null, log)
            next(null)
          }, 1000)
        }, function (err) {
          if (err) return this.emitsNewLog(err, null)
        })
      }
    })
  } catch (err) {
    return this.emitsNewLog(err, null)
  }
}

BridgeLogManager.prototype.emitsNewLog = function (err, log) {
  if (err) LogEmitter.emit('log-err', err)
  else LogEmitter.emit('new-log', log)
}

module.exports.init = singleton(BridgeLogManager)
module.exports.events = LogEmitter
