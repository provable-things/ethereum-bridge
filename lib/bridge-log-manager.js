'use strict'

const singleton = require('pragma-singleton')
const bridgeCore = require('./bridge-core')
const OracleInstance = bridgeCore.OracleInstance
const asyncLoop = require('node-async-loop')
const EventEmitter = require('events')

const LogEmitter = new EventEmitter()
var logsContainer = []

function BridgeLogManager () {
  this.contractInstance = OracleInstance().getContractInstance()
}

BridgeLogManager.prototype.watchEvents = function () {
  // watch all connector events
  try {
    logsContainer.push(this.contractInstance.Log1({'fromBlock': 'latest', 'toBlock': 'latest'}, emitsNewLog))

    logsContainer.push(this.contractInstance.Log2({'fromBlock': 'latest', 'toBlock': 'latest'}, emitsNewLog))

    logsContainer.push(this.contractInstance.LogN({'fromBlock': 'latest', 'toBlock': 'latest'}, emitsNewLog))
  } catch (err) {
    emitsNewLog(err, null)
  }
}

BridgeLogManager.prototype.fetchLogsByBlock = function (fromBlock, toBlock) {
  try {
    var log1e = this.contractInstance.Log1({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    log1e.get(function (err, data) {
      if (err) emitsNewLog(err, null)
      else {
        if (fromBlock !== 'latest' && toBlock !== 'latest') log1e.stopWatching()
        if (typeof data !== 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            emitsNewLog(null, log)
            next(null)
          }, 1000)
        }, function (err) {
          if (err) return emitsNewLog(err, null)
        })
      }
    })

    var log2e = this.contractInstance.Log2({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    log2e.get(function (err, data) {
      if (err) emitsNewLog(err, null)
      else {
        if (fromBlock !== 'latest' && toBlock !== 'latest') log1e.stopWatching()
        if (typeof data !== 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            emitsNewLog(null, log)
            next(null)
          }, 1000)
        }, function (err) {
          if (err) return emitsNewLog(err, null)
        })
      }
    })

    var logNe = this.contractInstance.LogN({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    logNe.get(function (err, data) {
      if (err) emitsNewLog(err, null)
      else {
        if (fromBlock !== 'latest' && toBlock !== 'latest') log1e.stopWatching()
        if (typeof data !== 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            emitsNewLog(null, log)
            next(null)
          }, 1000)
        }, function (err) {
          if (err) return emitsNewLog(err, null)
        })
      }
    })
  } catch (err) {
    return emitsNewLog(err, null)
  }
}

const emitsNewLog = function (err, log) {
  if (err) LogEmitter.emit('log-err', err)
  else LogEmitter.emit('new-log', log)
}

const removeAllLogs = function (e, type) {
  if (e) console.error(e)
  console.log('\nPlease wait...')
  asyncLoop(logsContainer, function (listening, next) {
    if (typeof listening !== 'undefined') listening.stopWatching()
    next(null)
  }, function (err) {
    if (err) console.error(err)
    process.exit()
  })
}

process.on('SIGINT', function () {
  removeAllLogs(null, {'clean': true})
})

process.on('uncaughtException', removeAllLogs)

module.exports.init = singleton(BridgeLogManager)
module.exports.events = LogEmitter
module.exports.removeAllLogs = removeAllLogs
