#!/usr/bin/env node
checkVersion()
var stdio = require('stdio')
var fs = require('fs')
var caminte = require('caminte')

var BRIDGE_VERSION = require('./package.json').version

/*
  allow to migrate and update queries on another database (atm supported only lokijs --to--> tingodb)
*/

var supportedDb = ['lokijs', 'tingodb']
var queriesDb

var ops = stdio.getopt({
  'migrate': {description: 'migrate database'},
  'from': {args: 1, description: 'type of database, supported: ', supportedDb},
  'frompath': {args: 1, description: 'path of --from database'},
  'to': {args: 1, description: 'type of database, supported: ', supportedDb},
  'topath': {args: 1, description: 'path of --to database'},
  'conn': {args: 1, description: 'connector address'},
  'oar': {args: 1, description: 'oar address'},
  'address': {args: 1, description: 'callback address'},
  'del': {args: '*', description: 'blacklist a list of contract myid (separated by space)'}
})

if (!ops.oar || !ops.address || !ops.conn) throw new Error('--conn --oar --address is required')

if (ops.migrate && !ops.frompath || !ops.topath || supportedDb.indexOf(ops.from) === -1 || supportedDb.indexOf(ops.to) === -1) throw new Error('--migrate requires --from & --frompath --to & --topath flags')

if (ops.from === 'lokijs') {
  try {
    var loki = require('lokijs')
  } catch (e) {
    console.log(e)
    throw new Error('lokijs module not found, please install lokijs')
  }
  var lokiDb = new loki(ops.frompath, {
    autoload: true,
    autoloadCallback: loadHandler,
    autosave: true,
    autosaveInterval: 10000
  })
}

function loadHandler () {
  if (ops.to !== 'tingodb') throw new Error('supported only lokijs --to--> tingodb')
  else {
    var DbSchema = caminte.Schema
    var dbConfig = {
      'driver': 'tingodb',
      'database': ops.topath
    }

    var db = new DbSchema(dbConfig.driver, dbConfig)

    var Query = db.define('Queries', {
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
      'bridge_version': {type: DbSchema.String, default: BRIDGE_VERSION}
    })
  }

  if (lokiDb.getCollection('queries') == null) {
    throw new Error('queries collection not found in database')
  } else {
    queriesDb = lokiDb.getCollection('queries')
    var pendingQueries = queriesDb.find({
      '$or': [{
        'active': true
      }, {
        'callback_complete': false
      }]
    })

    if (pendingQueries.length > 0) console.log('Found ' + pendingQueries.length + ' pending queries')
    else return

    for (var i = 0; i < pendingQueries.length; i++) {
      var queryDoc = pendingQueries[i]
      var targetUnix = parseInt(queryDoc.target_timestamp)
      if (ops.del && ops.del.indexOf(queryDoc.myIdInitial) > -1) continue
      var queryDocObj = {'http_myid': queryDoc.myid, 'contract_myid': queryDoc.myIdInitial, 'contract_address': queryDoc.contractAddress, 'proof_type': queryDoc.proofType, 'gas_limit': queryDoc.gasLimit}
      queryDocObj.oar = ops.oar
      queryDocObj.connector = ops.conn
      queryDocObj.cbAddress = ops.address
      queryDocObj.query_arg = queryDoc.query
      queryDocObj.query_datasource = queryDoc.datasource
      queryDocObj.event_tx = '0x00'
      queryDocObj.target_timestamp = targetUnix
      queryDocObj.block_tx_hash = '0x00'
      console.log('added', queryDocObj)
      Query.create(queryDocObj)
    }
  }
}

function checkVersion () {
  var prVersion = process.version
  if (prVersion.substr(1, 1) === '0' || prVersion.substr(1, 1) < 5) {
    console.error('Not compatible with ' + prVersion + ' of nodejs, please use at least v5.0.0')
    console.log('exiting...')
    process.exit(1)
  } else if (prVersion.substr(1, 1) > 7) {
    console.error('Not compatible with ' + prVersion + ' of nodejs, please use v6.9.1 or a lower version')
    console.log('exiting...')
    process.exit(1)
  }
}
