'use-strict'

const singleton = require('pragma-singleton')
const caminte = require('caminte')
const DbSchema = caminte.Schema
const extend = Object.assign
const NodeCache = require('node-cache')

function BridgeDbManager (config) {
  this.dbConfig = {}
  this.dbConfig.driver = config.driver
  this.dbConfig.database = config.database
  this.db = new DbSchema(this.dbConfig.driver, this.dbConfig)

  this.Query = this.db.define('Queries', {
    'contract_myid': {type: DbSchema.String},
    'http_myid': {type: DbSchema.String},
    'event_tx': {type: DbSchema.String},
    'block_tx_hash': {type: DbSchema.String},
    'query_active': {type: DbSchema.Boolean, default: true},
    'callback_complete': {type: DbSchema.Boolean, default: false},
    'callback_error': {type: DbSchema.Boolean, default: false},
    'retry_number': {type: DbSchema.Number, default: 0},
    'target_timestamp': {type: DbSchema.Date, default: 0},
    'oar': {type: DbSchema.String},
    'connector': {type: DbSchema.String},
    'cbAddress': {type: DbSchema.String},
    'query_delay': {type: DbSchema.Number, default: 0},
    'query_datasource': {type: DbSchema.String},
    'query_arg': {type: DbSchema.String},
    'contract_address': {type: DbSchema.String},
    'proof_type': {type: DbSchema.String, default: '0x00'},
    'gas_limit': {type: DbSchema.Number, default: 200000},
    'gas_price': {type: DbSchema.Number, default: 20000000000},
    'timestamp_db': {type: DbSchema.Date, default: Date.now()},
    'bridge_version': {type: DbSchema.String, default: config.BRIDGE_VERSION}
  })

  this.CallbackTx = this.db.define('CallbackTxs', {
    'tx_hash': {type: DbSchema.String},
    'oar': {type: DbSchema.String},
    'connector': {type: DbSchema.String},
    'cbAddress': {type: DbSchema.String},
    'contract_myid': {type: DbSchema.String},
    'contract_address': {type: DbSchema.String},
    'result': {type: DbSchema.String},
    'proof': {type: DbSchema.String, default: '0x00'},
    'gas_limit': {type: DbSchema.Number, default: 200000},
    'errors': {type: DbSchema.String},
    'timestamp_db': {type: DbSchema.Date, default: Date.now()},
    'tx_confirmed': {type: DbSchema.Boolean, default: false},
    'tx_confirmed_block_hash': {type: DbSchema.String},
    'bridge_version': {type: DbSchema.String, default: config.BRIDGE_VERSION}
  })
  this.cache = new NodeCache({'stdTTL': 300, 'checkperiod': 150})
}

BridgeDbManager.prototype.isAlreadyProcessed = function (contractMyid, cb) {
  const self = this
  this.isAlreadyProcessedDb(contractMyid, function (err, isProcessed) {
    if (err) return cb(err, null)
    if (isProcessed === true) return cb(null, true)
    else if (isProcessed === false && self.cache.get(contractMyid) === undefined) return cb(null, false)
    else return cb(null, isProcessed)
  })
}

BridgeDbManager.prototype.isAlreadyProcessedDb = function (contractMyid, cb) {
  const self = this
  this.Query.findOne({where: {'contract_myid': contractMyid}}, function (err, query1) {
    self.CallbackTx.findOne({where: {'contract_myid': contractMyid}}, function (err2, query2) {
      if (err2 || err) {
        return cb(new Error('database error'), false)
      } else {
        if (query2 !== null) {
          if ((typeof query2.tx_hash !== 'undefined' && query2.tx_hash.length > 0) ||
            (typeof query2.tx_confirmed !== 'undefined' && query2.tx_confirmed === true)) return cb(null, true)
        } else if (query1 !== null) {
          if ((Date.now() - query1.timestamp_db) < 300000) return cb(null, true)
          if (typeof query1.callback_error !== 'undefined' && query1.callback_error === false && query1.callback_complete === false && query2 === null) return cb(null, false)
        } else if (query1 === null && query2 === null) return cb(null, false)
        else return cb(null, true)
      }
    })
  })
}

BridgeDbManager.prototype.getPendingQueries = function (oar, cbAddress, callback) {
  this.Query.find({where: {'$and': [{'$or': [{'callback_complete': false}, {'query_active': true}], 'oar': oar, 'cbAddress': cbAddress}]}, order: 'timestamp_db ASC'}, function (err, queries) {
    if (err) return callback(err, [])
    return callback(null, queries)
  })
}

BridgeDbManager.prototype.createDbQuery = function (queryParams, callback) {
  var defaultQueryObj = {
    'active': true,
    'callback_complete': false,
    'retry_number': 0
  }

  var queryObj = extend(defaultQueryObj, queryParams)

  this.Query.create(queryObj, function (err, res) {
    if (err) return callback(err, null)
    return callback(null, res)
  })
}

BridgeDbManager.prototype.updateDbQuery = function (myid, queryObj, callback) {
  const self = this
  this.Query.update({where: {'contract_myid': myid}}, {'$set': queryObj.query}, function (err1, res1) {
    self.CallbackTx.updateOrCreate({'contract_myid': myid}, queryObj.callback, function (err, res) {
      if (err1) return callback('queries database update failed for query with contract myid', myid, null)
      if (err) return callback('failed to add a new transaction to database' + err, null)
      return callback(null, true)
    })
  })
}

BridgeDbManager.prototype.getOneQuery = function (myid, callback) {
  this.Query.findOne({where: {'contract_myid': myid}}, function (errQuery, contractInfo) {
    if (errQuery) return callback(errQuery, null)
    return callback(null, contractInfo)
  })
}

BridgeDbManager.prototype.checkCallbackQueryStatus = function (myid, callback) {
  const self = this
  this.Query.findOne({where: {'contract_myid': myid}}, function (err, res) {
    if (err) return callback(err, null)
    if (res === null) return callback(new Error('queryComplete error, query with contract myid ' + myid + ' not found in database'), null)
    if (typeof res.callback_complete === 'undefined') return callback(new Error('queryComplete error, query with contract myid ' + myid), null)
    self.CallbackTx.findOne({where: {'contract_myid': myid}}, function (errC, resC) {
      return callback(null, {'query': res, 'callback': resC})
    })
  })
}

module.exports.BridgeDbManager = singleton(BridgeDbManager)
