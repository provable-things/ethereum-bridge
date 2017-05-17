'use strict'

const singleton = require('pragma-singleton')
const bridgeCore = require('./bridge-core')
const OracleInstance = bridgeCore.OracleInstance
const extend = Object.assign
const asyncLoop = require('node-async-loop')
const ethUtil = require('ethereumjs-util')
const BlockchainInterface = require('./blockchain-interface')
const cbor = require('borc')
const EventEmitter = require('events')

const LogEmitter = new EventEmitter()
LogEmitter.setMaxListeners(1)

var logsContainer = []

function BridgeLogManager () {
  this.contractInstance = OracleInstance().getContractInstance()
}

BridgeLogManager.prototype.watchEvents = function () {
  // watch all connector events
  try {
    logsContainer.push(this.contractInstance.Log1({'fromBlock': 'latest', 'toBlock': 'latest'}, parseLog))

    logsContainer.push(this.contractInstance.Log2({'fromBlock': 'latest', 'toBlock': 'latest'}, parseLog))

    logsContainer.push(this.contractInstance.LogN({'fromBlock': 'latest', 'toBlock': 'latest'}, parseLog))
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
        if (typeof data === 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            parseLog(null, log)
            next(null)
          }, 50)
        }, function (err) {
          if (err) return emitsNewLog(err, null)
        })
      }
    })

    var log2e = this.contractInstance.Log2({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    log2e.get(function (err, data) {
      if (err) emitsNewLog(err, null)
      else {
        if (fromBlock !== 'latest' && toBlock !== 'latest') log2e.stopWatching()
        if (typeof data === 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            parseLog(null, log)
            next(null)
          }, 50)
        }, function (err) {
          if (err) return emitsNewLog(err, null)
        })
      }
    })

    var logNe = this.contractInstance.LogN({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    logNe.get(function (err, data) {
      if (err) emitsNewLog(err, null)
      else {
        if (fromBlock !== 'latest' && toBlock !== 'latest') logNe.stopWatching()
        if (typeof data === 'undefined' || data.length === 0) return
        asyncLoop(data, function (log, next) {
          setTimeout(function () {
            parseLog(null, log)
            next(null)
          }, 50)
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

const parseLog = function (err, log) {
  if (err) return emitsNewLog(err, null)
  var logObj = {}
  logObj['parsed_log'] = {}
  extend(logObj, log)
  var logArgs = log['args']
  logObj['parsed_log'].contract_address = logArgs['sender']
  logObj['parsed_log'].contract_myid = logArgs['cid']
  logObj['parsed_log'].datasource = logArgs['datasource']

  if (log['event'] === 'Log1') {
    if (typeof logArgs['arg'] === 'undefined' || logArgs['arg'] === false) logObj.malformed = true
    else logObj['parsed_log'].formula = logArgs['arg']
  } else if (log['event'] === 'Log2') {
    if ((typeof logArgs['arg1'] === 'undefined' && typeof logArgs['arg2'] === 'undefined') || logArgs['arg1'] === false || logArgs['arg2'] === false) logObj.malformed = true
    else logObj['parsed_log'].formula = [logArgs['arg1'], logArgs['arg2']]
  } else if (log['event'] === 'LogN') {
    if (typeof logArgs['args'] === 'undefined' || logArgs['args'] === false) logObj.malformed = true
    else {
      logObj['parsed_log'].formula = []
      var cborDecoded = cbor.decodeFirst(Buffer.from(logArgs['args'].substr(2), 'hex'))
      for (var i = 0; i < cborDecoded.length; i++) {
        var cborDecStand = Buffer.isBuffer(cborDecoded[i]) ? {'type': 'hex', 'value': cborDecoded[i].toString('hex')} : cborDecoded[i]
        logObj['parsed_log'].formula.push(cborDecStand)
      }
    }
  }
  logObj['parsed_log'].timestamp = logArgs['timestamp'].toNumber()
  logObj['parsed_log'].gaslimit = logArgs['gaslimit'].toNumber()
  logObj['parsed_log'].proofType = ethUtil.addHexPrefix(logArgs['proofType'])

  if (logArgs['gasPrice']) logObj['parsed_log'].gasPrice = logArgs['gasPrice'].toNumber()

  logObj['block_timestamp'] = BlockchainInterface().inter.getBlock(log['blockHash']).timestamp

  emitsNewLog(null, logObj)
}

const removeAllLogs = function (e, type) {
  if (e) console.error(e)
  console.log('\nPlease wait...')
  if (BlockchainInterface().isConnected()) {
    asyncLoop(logsContainer, function (listening, next) {
      if (typeof listening !== 'undefined') listening.stopWatching()
      next(null)
    }, function (err) {
      if (err) console.error(err)
      process.exit()
    })
  } else process.exit()
}

process.on('SIGINT', function () {
  removeAllLogs(null, {'clean': true})
})

process.on('uncaughtException', removeAllLogs)

module.exports.init = singleton(BridgeLogManager)
module.exports.events = LogEmitter
module.exports.removeAllLogs = removeAllLogs
