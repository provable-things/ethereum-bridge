'use-strict'

const caminte = require('caminte')
const DbSchema = caminte.Schema
const singleton = require('pragma-singleton')

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
    'timestamp_db': {type: DbSchema.Date, default: Date.now() },
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
    'timestamp_db': {type: DbSchema.Date, default: Date.now() },
    'tx_confirmed': {type: DbSchema.Boolean, default: false},
    'tx_confirmed_block_hash': {type: DbSchema.String},
    'bridge_version': {type: DbSchema.String, default: config.BRIDGE_VERSION}
  })
}

module.exports.BridgeDbManager = singleton(BridgeDbManager)
