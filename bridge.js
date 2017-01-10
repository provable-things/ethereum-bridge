#!/usr/bin/env node
checkVersion()
var stdio = require('stdio')
var request = require('request')
var readline = require('readline')
var i18n = require('i18n')
var caminte = require('caminte')
var versionCompare = require('compare-versions')
var schedule = require('node-schedule')
var bridgeUtil = require('./lib/bridge-util')
var bridgeCore = require('./lib/bridge-core')
var winston = require('winston')
var colors = require('colors/safe')
var async = require('async')
var fs = require('fs')
var cbor = require('cbor')
var path = require('path')
var OracleInstance = bridgeCore.OracleInstance
var activeOracleInstance

var colorMap = {
  'info': 'cyan',
  'warn': 'yellow',
  'error': 'red'
}

function colorize (string) {
  var type = string.toLowerCase()
  if (typeof colorMap[type] !== 'undefined') {
    return colors[colorMap[type]](string)
  } else return string
}

var DbSchema = caminte.Schema
var dbConfig = {
  'driver': 'tingodb',
  'database': './database/tingodb/'
}

if (!fs.existsSync(dbConfig.database)) {
  fs.mkdirSync(dbConfig.database)
}

var db = new DbSchema(dbConfig.driver, dbConfig)

i18n.configure({
  defaultLocale: 'ethereum',
  updateFiles: false,
  objectNotation: true,
  directory: './config/text'
})

var BLOCKCHAIN_NAME = i18n.__('blockchain_name')
var BLOCKCHAIN_ABBRV = i18n.__('blockchain_abbrv')
var BLOCKCHAIN_BASE_UNIT = i18n.__('base_unit')
var BRIDGE_NAME = i18n.__('bridge_name')
var BRIDGE_VERSION = require('./package.json').version

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

var CallbackTx = db.define('CallbackTxs', {
  'tx_hash': {type: DbSchema.String},
  'contract_myid': {type: DbSchema.String},
  'contract_address': {type: DbSchema.String},
  'result': {type: DbSchema.String},
  'proof': {type: DbSchema.String, default: '0x00'},
  'gas_limit': {type: DbSchema.Number, default: 200000},
  'errors': {type: DbSchema.String},
  'timestamp_db': {type: DbSchema.Date, default: Date.now() },
  'bridge_version': {type: DbSchema.String, default: BRIDGE_VERSION}
})

var mode = 'active'
var defaultnode = 'localhost:8545'
var logFilePath = ''
var myIdList = []
var keyFilePath = toFullPath('./config/instance/keys.json')
var configFilePath = ''
var defaultGas = 3000000
var resumeQueries = false
var skipQueries = false
var confirmations = 12
var callbackRunning = false
var reorgRunning = false
var latestBlockNumber = -1
var isTestRpc = false
var reorgInterval = []
var blockRangeResume = []

var ops = stdio.getopt({
  'instance': {args: 1, description: 'filename of the oracle configuration file that can be found in ./config/instance/ (i.e. oracle_instance_148375903.json)'},
  'oar': {key: 'o', args: 1, description: 'OAR Oraclize (address)'},
  'url': {key: 'u', args: 1, description: BLOCKCHAIN_ABBRV + ' node URL (default: http://' + defaultnode + ')'},
  'HOST': {key: 'H', args: 1, description: BLOCKCHAIN_ABBRV + ' node IP:PORT (default: ' + defaultnode + ')'},
  'port': {key: 'p', args: 1, description: BLOCKCHAIN_ABBRV + ' node localhost port (default: 8545)'},
  'address': {key: 'a', args: 1, description: 'unlocked address used to deploy Oraclize connector and OAR'},
  'broadcast': {description: 'broadcast only mode, a json key file with the private key is mandatory to sign all transactions'},
  'gas': {args: 1, description: 'change gas amount limit used to deploy contracts(in wei) (default: ' + defaultGas + ')'},
  'key': {args: 1, description: 'JSON key file path (default: ' + keyFilePath + ')'},
  'new': {description: 'Generate and save a new address in ' + keyFilePath + ' file'},
  'logfile': {args: 1, description: 'bridge log file path (default: current bridge folder)'},
  'nocomp': {description: 'disable contracts compilation'},
  'forcecomp': {description: 'force contracts compilation'},
  'confirmation': {args: 1, description: 'specify the minimum confirmations to validate a transaction in case of chain re-org. (default: ' + confirmations + ')'},
  'abiconn': {args: 1, description: 'Load custom connector abi interface (path)'},
  'abioar': {args: 1, description: 'Load custom oar abi interface (path)'},
  'newconn': {description: 'Generate and update the OAR with the new connector address'},
  // 'changeconn': {args:1, description: 'Provide a connector address and update the OAR with the new connector address'},
  'loadabi': {description: 'Load default abi interface (under ' + BRIDGE_NAME + '/contracts/abi)'},
  'from': {args: 1, description: 'fromBlock (number) to resume logs (--to is required)'},
  'to': {args: 1, description: 'toBlock (number) to resume logs (--from is required)'},
  'resume': {description: 'resume all skipped queries (note: retries will not be counted/updated)'},
  'skip': {description: 'skip all pending queries (note: retries will not be counted/updated)'}
})

console.log('Please wait...')

if (ops.logfile) {
  if (ops.logfile.slice(-1) === '/') {
    logFilePath = ops.logfile + 'bridge.log'
  } else {
    logFilePath = ops.logfile + '/bridge.log'
  }
} else {
  logFilePath = './bridge.log'
}

var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      colorize: true,
      timestamp: function () {
        return Date.now()
      },
      formatter: function (options) {
        return '[' + colors.grey(options.timestamp()) + '] ' + colorize(options.level.toUpperCase()) + ' ' + (options.message ? options.message : '') +
          (options.meta && Object.keys(options.meta).length ? '\n\t' + JSON.stringify(options.meta) : '')
      }
    }),
    new (winston.transports.File)({
      filename: logFilePath
    })
  ]
})

if (ops.from && ops.to) {
  if (ops.to === 'latest' || ops.from === 'latest') throw new Error('latest is not allowed')
  if (ops.to < ops.from) throw new Error('toBlock should be > of fromBlock')
  blockRangeResume = [ops.from, ops.to]
  logger.info('block range to resume:', blockRangeResume)
} else if (ops.from && !ops.to) throw new Error('--from flag requires the --to flag')
else if (!ops.from && ops.to) throw new Error('--to flag requires the --from flag')

if (ops.confirmation) {
  if (ops.confirmation <= 0) throw new Error('confirmations must be > 0')
  confirmations = ops.confirmation
}

if (ops.url) {
  if (ops.port) throw new Error("--url flag doesn't accept a port")
  defaultnode = ops.url
}

if (ops.HOST) {
  defaultnode = ops.HOST
}

if (ops.port) {
  if (defaultnode.indexOf(':') > -1) throw new Error('port already specified')
  defaultnode += ':' + ops.port
}

if (ops.skip) {
  skipQueries = true
}

if (ops.resume) {
  resumeQueries = true
}

if (ops.gas) {
  if (ops.gas < 1970000) {
    throw new Error('Gas amount lower than 1970000 is not allowed')
  } else if (ops.gas > 4700000) {
    throw new Error('Gas amount bigger than 4700000 is not allowed')
  } else {
    defaultGas = ops.gas
  }
}

if (defaultnode.indexOf(':') === -1) {
  defaultnode = 'http://' + defaultnode + ':8545'
} else if (defaultnode.indexOf('http') === -1) {
  defaultnode = 'http://' + defaultnode
}

if (ops.broadcast) {
  mode = 'broadcast'
  try {
    var privateKeyContent = fs.readFileSync(keyFilePath)
    if (JSON.parse(privateKeyContent.toString()).length > 0) {
      ops.address = 0
    } else if (ops.address) {
      ops.new = true
      logger.error('no account', ops.address, 'found in your keys.json file, automatically removing the -a option...')
      ops.address = null
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      ops.new = true
      logger.warn('keys.json not found, creating the new file', keyFilePath)
      try {
        bridgeUtil.saveJsonFile(keyFilePath, JSON.stringify([]))
      } catch (e) {
        logger.error('failed to save the key file', e)
      }
    }
  }
}

logger.info('saving logs to:', logFilePath)

var oraclizeConfiguration = {
  'oar': ops.oar,
  'node': {
    'main': defaultnode,
    'backup': []
  },
  'contracts': {
    'connector': {
      'binary': toFullPath('./contracts/binary/oraclizeConnector.binary'),
      'abi': toFullPath('./contracts/abi/oraclizeConnector.json'),
      'source': toFullPath('./contracts/ethereum-api/connectors/oraclizeConnector.sol')
    },
    'oar': {
      'binary': toFullPath('./contracts/binary/addressResolver.binary'),
      'abi': toFullPath('./contracts/abi/addressResolver.json'),
      'source': toFullPath('./contracts/ethereum-api/connectors/addressResolver.sol')
    }
  },
  'deploy_gas': defaultGas,
  'account': ops.address,
  'mode': mode,
  'key_file': keyFilePath
}

if (ops.abiconn || ops.abioar) {
  if (ops.abiconn) oraclizeConfiguration.contracts.connector.abi = toFullPath(ops.abiconn)
  if (ops.abioar) oraclizeConfiguration.contracts.oar.abi = toFullPath(ops.abioar)
}

if (ops.instance) {
  var instanceToLoad = ops.instance
  var instances = fs.readdirSync('./config/instance/')
  var instanceKeyIndex = instances.indexOf('keys.json')
  if (instanceKeyIndex > -1) {
    instances.splice(instanceKeyIndex, 1)
  }
  var keepFile = instances.indexOf('.keep')
  if (keepFile > -1) {
    instances.splice(keepFile, 1)
  }
  if (instances.length === 0) throw new Error('no instance files found')
  if (instanceToLoad !== 'latest' && instanceToLoad.indexOf('.json') === -1) {
    instanceToLoad += '.json'
  }
  if (instances.indexOf(instanceToLoad) > -1) {
    importConfigFile(instanceToLoad)
  } else if (instanceToLoad === 'latest') {
    instanceToLoad = instances[instances.length - 1]
    importConfigFile(instanceToLoad)
  } else {
    logger.error(instanceToLoad + ' not found in ./config/instance/')
  }
} else if (!ops.oar) {
  if (ops.new && ops.address) throw new Error("--new flag doesn't require the -a flag")
  if (ops.new && ops.broadcast) {
    bridgeUtil.generateNewAddress(keyFilePath, function (err, res) {
      if (err) throw new Error(err)
      logger.info('New address generated', res.address, 'at position: ' + res.account_position)
      oraclizeConfiguration.account = res.account_position
      deployOraclize()
    })
  } else if (ops.new && !ops.broadcast) throw new Error('--new flag requires --broadcast mode')
  else deployOraclize()
} else {
  if (ops.new) throw new Error('cannot generate a new address if contracts are already deployed, please remove the --new flag')
  startUpLog()
  oracleFromConfig(oraclizeConfiguration)
}

function toFullPath (filePath) {
  return path.join(__dirname, filePath)
}

function oracleFromConfig (config) {
  try {
    activeOracleInstance = new OracleInstance(config)
    checkNodeConnection()
    activeOracleInstance.isValidOracleInstance()
    userWarning()
    logger.info('OAR found:', activeOracleInstance.oar)
    logger.info('connector found:', activeOracleInstance.connector)
    logger.info('callback address:', activeOracleInstance.account)
    if (!ops.newconn) runLog()
    else {
      var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      })
      rl.question('Are you sure you want to generate a new connector and update the Address Resolver? [Y/n]: ', function (answ) {
        var answ = answ.toLowerCase()
        if (answ.match(/y/)) {
          rl.close()
          console.log('Please wait...')
          activeOracleInstance.deployConnector(function (err, connectorRes) {
            if (err) throw new Error(err)
            if (connectorRes.success === true) {
              logger.info('successfully generated a new connector', connectorRes.connector)
              activeOracleInstance.setAddr(activeOracleInstance.oar, connectorRes.connector, function (err, res) {
                if (err) throw new Error(err)
                if (res.success === true) {
                  oraclizeConfiguration.connector = connectorRes.connector
                  logger.info('successfully updated the Address Resolver')
                  bridgeUtil.saveJsonFile(configFilePath, oraclizeConfiguration)
                  runLog()
                }
              })
            }
          })
        } else throw new Error('exiting no authorization given, please remove the --newconn flag')
      })
    }
  } catch (e) {
    logger.error(e.message)
    if (e.message.match(/JSON RPC response: undefined/)) nodeError()
    else throw new Error(e)
  }
}

function processPendingQueries (oar, connector, cbAddress) {
  oar = oar || activeOracleInstance.oar
  connector = connector || activeOracleInstance.connector
  cbAddress = cbAddress || activeOracleInstance.account
  logger.info('fetching pending queries from database with oar:', oar, 'and callback address:', cbAddress)
  Query.find({where: {'$and': [{'$or': [{'callback_complete': false}, {'query_active': true}], 'oar': oar, 'cbAddress': cbAddress}]}, order: 'timestamp_db ASC'}, function (err, pendingQueries) {
    if (err) logger.error('fetching queries error', err)
    else {
      logger.info('found a total of', pendingQueries.length, 'pending queries')
      if (pendingQueries.length === 0) return

      if (skipQueries === true) {
        logger.warn('skipping all pending queries')
        return
      } else if (resumeQueries === true) {
        logger.warn('forcing the resume of all pending queries')
      }
      async.each(pendingQueries, function (thisPendingQuery, callback) {
        if (thisPendingQuery.callback_error === true) logger.warn('skipping', thisPendingQuery.contract_myid, 'because of __callback tx error')
        else if (thisPendingQuery.retry_number < 3 || resumeQueries) {
          var targetUnix = parseInt(thisPendingQuery.target_timestamp)
          var queryTimeDiff = targetUnix < parseInt(Date.now() / 1000) ? 0 : targetUnix
          logger.info('re-processing query', {'contact_address:': thisPendingQuery.contact_address, 'contact_myid': thisPendingQuery.contract_myid, 'http_myid': thisPendingQuery.http_myid})
          if (queryTimeDiff <= 0) {
            checkQueryStatus(thisPendingQuery.http_myid, thisPendingQuery.contract_myid, thisPendingQuery.contract_address, thisPendingQuery.proof_type, thisPendingQuery.gas_limit)
          } else {
            var targetDate = new Date(targetUnix * 1000)
            processQueryInFuture(targetDate, thisPendingQuery)
          }
          callback()
        } else logger.warn('skipping', thisPendingQuery.contract_myid, 'query, exceeded 3 retries')
      })
    }
  })
}

function importConfigFile (instanceToLoad) {
  configFilePath = toFullPath('./config/instance/' + instanceToLoad)
  loadConfigFile(configFilePath)
  logger.info('using ' + instanceToLoad + ' oracle configuration file')
}

function loadConfigFile (file) {
  var configFile = bridgeUtil.loadLocalJson(file)
  if (typeof configFile.mode !== 'undefined' && typeof configFile.account !== 'undefined' && typeof configFile.oar !== 'undefined' && typeof configFile.node !== 'undefined') {
    oraclizeConfiguration = configFile
    mode = configFile.mode
    defaultnode = configFile.node.main
    startUpLog()
    setTimeout(function () {
      oracleFromConfig(configFile)
    }, 200)
  } else return logger.error(file + ' configuration is not valid')
}

function startUpLog () {
  logger.info('using', mode, 'mode')
  logger.info('Connecting to ' + BLOCKCHAIN_ABBRV + ' node ' + defaultnode)
  checkBridgeVersion()
}

function userWarning () {
  logger.warn('Using', activeOracleInstance.account, 'to query contracts on your blockchain, make sure it is unlocked and do not use the same address to deploy your contracts')
}

function checkNodeConnection () {
  if (!activeOracleInstance.isConnected()) nodeError()
}

function getHostAndPort (nodeHttp) {
  var nodeSplit = nodeHttp.substring(nodeHttp.indexOf('://') + 3).split(':')
  var portSplit = nodeSplit[1] || '8545'
  var hostSplit = nodeSplit[0] || '127.0.0.1'
  if (hostSplit === 'localhost') hostSplit = '127.0.0.1'
  return [hostSplit, portSplit]
}

function nodeError () {
  var nodeinfo = getHostAndPort(defaultnode)
  var hostSplit = nodeinfo[0]
  var portSplit = nodeinfo[1]
  var startString = i18n.__('connection_failed_tip')
  startString = startString ? startString.replace(/@HOST/g, hostSplit).replace(/@PORT/g, portSplit).replace(/'/g, '"') : ''
  throw new Error(defaultnode + ' ' + BLOCKCHAIN_NAME + ' node not found, are you sure is it running?\n ' + startString)
}

function checkBridgeVersion () {
  request.get('https://api.oraclize.it/v1/platform/info', {json: true, headers: { 'X-User-Agent': BRIDGE_NAME + '/' + BRIDGE_VERSION + ' (nodejs)' }}, function (error, response, body) {
    if (error) return
    try {
      if (response.statusCode === 200) {
        if (!(BRIDGE_NAME in body.result.distributions)) return
        var latestVersion = body.result.distributions[BRIDGE_NAME].latest.version
        if (versionCompare(BRIDGE_VERSION, latestVersion) === -1) {
          logger.warn('\n************************************************************************\nA NEW VERSION OF THIS TOOL HAS BEEN DETECTED\nIT IS HIGHLY RECOMMENDED THAT YOU ALWAYS RUN THE LATEST VERSION, PLEASE UPGRADE TO ' + BRIDGE_NAME.toUpperCase() + ' ' + latestVersion + '\n************************************************************************\n')
        }
      }
    } catch (e) {}
  })
}

function deployOraclize () {
  startUpLog()
  try {
    activeOracleInstance = new OracleInstance(oraclizeConfiguration)
    checkNodeConnection()
    userWarning()
  } catch (e) {
    if (e.message.match(/JSON RPC response: undefined/)) return nodeError()
    else throw new Error(e)
  }
  async.waterfall([
    function (callback) {
      var accountBalance = activeOracleInstance.checkAccountBalance()
      var amountToPay = 500000000000000000 - accountBalance
      if (amountToPay > 0) {
        logger.warn(activeOracleInstance.account, 'doesn\'t have enough funds to cover transaction costs, please send at least ' + parseFloat(amountToPay / 1e19) + ' ' + BLOCKCHAIN_BASE_UNIT)
        if (bridgeCore.web3.version.node.match(/TestRPC/)) {
          // node is TestRPC
          var rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          })
          rl.question('Authorize the bridge to move funds automatically from your node? [Y/n]: ', function (answ) {
            answ = answ.toLowerCase()
            if (answ.match(/y/)) {
              var userAccount = ''
              rl.question('Please choose the unlocked account index number in your node: ', function (answ) {
                if (answ >= 0) {
                  userAccount = bridgeCore.web3.eth.accounts[answ]
                  if (typeof (userAccount) === 'undefined') {
                    rl.close()
                    throw new Error('Account at index number: ' + answ + ' not found')
                  }
                  rl.question('send ' + parseFloat(amountToPay / 1e19) + ' ' + BLOCKCHAIN_BASE_UNIT + ' from account ' + userAccount + ' (index n.: ' + answ + ') to ' + activeOracleInstance.account + ' ? [Y/n]: ', function (answ) {
                    answ = answ.toLowerCase()
                    if (answ.match(/y/)) {
                      bridgeCore.web3.eth.sendTransaction({'from': userAccount, 'to': activeOracleInstance.account, 'value': amountToPay})
                      rl.close()
                    } else {
                      console.log('No authorization given, waiting for funds...')
                      rl.close()
                    }
                  })
                } else {
                  console.log('Negative account index not allowed')
                  rl.close()
                }
              })
            } else {
              console.log('No authorization given, waiting for funds...')
              rl.close()
            }
          })
        }
        var checkBalance = setInterval(function () {
          var balance = activeOracleInstance.checkAccountBalance()
          var amountToPay = 500000000000000000 - balance
          if (amountToPay <= 0) {
            logger.info('received funds')
            clearInterval(checkBalance)
            if (typeof rl !== 'undefined') rl.close()
            callback(null, true)
          }
        }, 10000)
      } else callback(null, true)
    },
    function deployConnector (result, callback) {
      activeOracleInstance.deployConnector(callback)
    },
    function deployOAR (result, callback) {
      logger.info('connector deployed to:', result.connector)
      activeOracleInstance.deployOAR(callback)
    }
  ], function (err, result) {
    if (err) throw new Error(err)
    logger.info('address resolver (OAR) deployed to:', result.oar)
    logger.info('successfully deployed all contracts')
    oraclizeConfiguration.oar = result.oar
    oraclizeConfiguration.connector = activeOracleInstance.connector
    oraclizeConfiguration.account = activeOracleInstance.account
    configFilePath = toFullPath('./config/instance/oracle_instance_' + parseInt(Date.now() / 1000) + '.json')
    try {
      bridgeUtil.saveJsonFile(configFilePath, oraclizeConfiguration)
      logger.info('instance configuration file saved to ' + configFilePath)
    } catch (err) {
      logger.error('instance configuration file ' + configFilePath + ' not saved', err)
    }
    runLog()
  })
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

function runLog () {
  console.log('\nPlease add this line to your contract constructor:\n\n' + 'OAR = OraclizeAddrResolverI(' + activeOracleInstance.oar + ');\n')

  // listen for latest events
  fetchLogs()

  var nodeType = bridgeCore.web3.version.node

  isTestRpc = nodeType.match(/TestRPC/) ? true : false

  logger.info('connected to node type', nodeType)

  if (isTestRpc) logger.warn('re-org block listen is disabled when using testrpc')
  else reorgListen()

  logger.info('Listening @ ' + activeOracleInstance.connector + ' (Oraclize Connector)\n')

  console.log('(Ctrl+C to exit)\n')

  processPendingQueries()

  if (blockRangeResume.length === 2) {
    setTimeout(function () {
      logger.info('resuming logs from block range:', blockRangeResume)
      fetchLogsByBlock(parseInt(blockRangeResume[0]), parseInt(blockRangeResume[1]))
    }, 5000)
  }
}

function processQueryInFuture (date, query) {
  logger.info('checking HTTP query ' + query.http_myid + ' status on ' + date)
  schedule.scheduleJob(date, function () {
    checkQueryStatus(query.http_myid, query.contract_myid, query.contract_address, query.proof_type, query.gas_limit)
  })
}

function reorgListen (from) {
  try {
    if (isTestRpc) return
    var initialBlock = from || bridgeCore.web3.eth.blockNumber - (confirmations * 2)
    var prevBlock = -1
    var latestBlock = -1
    reorgRunning = false
    reorgInterval = setInterval(function () {
      try {
        if (reorgRunning === true) return
        latestBlock = bridgeCore.web3.eth.blockNumber
        if (prevBlock === -1) prevBlock = latestBlock
        if (latestBlock > prevBlock && prevBlock !== latestBlock && (latestBlock - initialBlock) > confirmations) {
          prevBlock = latestBlock
          reorgRunning = true
          fetchLogsByBlock(initialBlock, initialBlock, true)
          initialBlock += 1
        }
      } catch (e) {
        logger.error('reorgListen error', e)
        manageErrors(e)
      }
    }, 30000)
  } catch (e) {
    logger.error('reorgListen error', e)
    manageErrors(e)
  }
}

function fetchLogsByBlock (fromBlock, toBlock, reorgType) {
  if (isTestRpc) return
  // fetch all connector events
  try {
    var contractInstance = activeOracleInstance.getContractInstance()
    var log1e = contractInstance.Log1({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    log1e.get(function (err, data) {
      if (err == null) {
        parseMultipleLogs(data)
        if (fromBlock !== 'latest' && toBlock !== 'latest') log1e.stopWatching()
      } else {
        logger.error('fetchLogsByBlock error', err)
        manageErrors(err)
      }
    })

    var log2e = contractInstance.Log2({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
    log2e.get(function (err, data) {
      if (err == null) {
        parseMultipleLogs(data)
        if (fromBlock !== 'latest' && toBlock !== 'latest') log2e.stopWatching()
      } else {
        logger.error('fetchLogsByBlock error', err)
        manageErrors(err)
      }
    })

    if (activeOracleInstance.availableLogs.indexOf('LogN') > -1) {
      var logNe = contractInstance.LogN({}, {'fromBlock': fromBlock, 'toBlock': toBlock})
      logNe.get(function (err, data) {
        if (err == null) {
          parseMultipleLogs(data)
          if (fromBlock !== 'latest' && toBlock !== 'latest') logNe.stopWatching()
        } else {
          logger.error('fetchLogsByBlock error', err)
          manageErrors(err)
        }
      })
    }

    if (reorgType === true) {
      setTimeout(function () {
        reorgRunning = false
      }, 2000)
    }
  } catch (err) {
    logger.error('log filter error', err)
  }
}

function fetchLogs () {
  // fetch all connector events
  try {
    var contractInstance = activeOracleInstance.getContractInstance()
    contractInstance.Log1({'fromBlock': 'latest', 'toBlock': 'latest'}, function (err, data) {
      if (err == null) {
        manageLog(data)
      } else {
        logger.error('fetchLog error', err)
        manageErrors(err)
      }
    })

    contractInstance.Log2({'fromBlock': 'latest', 'toBlock': 'latest'}, function (err, data) {
      if (err == null) {
        manageLog(data)
      } else {
        logger.error('fetchLog error', err)
        manageErrors(err)
      }
    })

    if (activeOracleInstance.availableLogs.indexOf('LogN') > -1) {
      contractInstance.LogN({'fromBlock': 'latest', 'toBlock': 'latest'}, function (err, data) {
        if (err == null) {
          manageLog(data)
        } else {
          logger.error('fetchLog error', err)
          manageErrors(err)
        }
      })
    }
  } catch (err) {
    logger.error('log filter error', err)
  }
}

function parseMultipleLogs (data) {
  async.each(data, function(log, callback) {
    manageLog(log)
    callback()
  })
}

function manageLog (data) {
  try {
    if (!('args' in data)) return logger.error('no args found in log', data)
    var contractMyid = data.args['cid']
    isAlreadyProcessed(contractMyid, function (err, isProcessed) {
      if (err) isProcessed = false
      if (isProcessed === false && myIdList.indexOf(contractMyid) === -1) {
        if (activeOracleInstance.isOracleEvent(data)) {
          handleLog(data)
        } else {
          logger.warn('log with contract myid:', contractMyid, 'was triggered, but is not recognized as an oracle event')
        }
      } else logger.warn('log with contract myid:', contractMyid, 'was triggered, but it was already seen before')
    })
  } catch (e) {
    logger.error('manageLog error', e)
  }
}

function isAlreadyProcessed (contractMyid, cb) {
  Query.findOne({where: {'contract_myid': contractMyid}}, function (err, query1) {
    if (err) logger.error('Query database findOne error', err)
    CallbackTx.findOne({where: {'contract_myid': contractMyid}}, function (err2, query2) {
      if (err2 || err) {
        logger.error('Callback database findOne error', err2, err)
        return cb(new Error('database error'), false)
      } else {
        if (query2 !== null) {
          if (typeof query2.tx_hash !== 'undefined' && query2.tx_hash.length > 0) return cb(null, true)
        } else if (query1 !== null) {
          if (typeof query1.callback_error !== 'undefined' && query1.callback_error === false && query1 === null) return cb(null, false)
        } else if (query1 === null && query2 === null) cb(null, false)
        else return cb(null, true)
      }
    })
  })
}

function handleLog (data) {
  try {
    logger.info('new log ', data)
    var eventTx = data['transactionHash']
    var blockHashTx = data['blockHash']
    data = data['args']
    var myIdInitial = data['cid']
    if (myIdList.indexOf(myIdInitial) > -1) return
    myIdList.push(myIdInitial)
    latestBlockNumber = bridgeCore.web3.eth.blockNumber
    var myid = myIdInitial
    var cAddr = data['sender']
    var ds = data['datasource']
    var formula = data['arg']
    if (typeof (data['arg']) !== 'undefined') {
      if (data['arg'] === false) return logger.error('malformed log, skipping...')
      formula = data['arg']
    } else if (typeof (data['args']) !== 'undefined') {
      if (data['args'] === false) return logger.error('malformed log, skipping...')
      formula = cbor.decodeAllSync(new Buffer(data['args'].substr(2), 'hex'))[0]
    } else {
      if (data['arg1'] === false || data['arg2'] === false) return logger.error('malformed log, skipping...')
      formula = [data['arg1'], data['arg2']]
    }
    var time = data['timestamp'].toNumber()
    var gasLimit = data['gaslimit'].toNumber()
    var proofType = bridgeCore.ethUtil.addHexPrefix(data['proofType'])
    var query = {
      when: time,
      datasource: ds,
      query: formula,
      id2: bridgeCore.ethUtil.stripHexPrefix(myIdInitial),
      proof_type: bridgeUtil.toInt(proofType)
    }
    createQuery(query, function (data) {
      if (typeof data.result.id === 'undefined') return logger.error('no HTTP myid found, skipping log...')
      myid = data.result.id
      logger.info('new HTTP query created, id: ' + myid)
      var unixTime = parseInt(Date.now() / 1000)
      var queryCheckUnixTime = getQueryUnixTime(time, unixTime)
      Query.create({'active': true, 'callback_complete': false, 'retry_number': 0, 'target_timestamp': queryCheckUnixTime, 'oar': activeOracleInstance.oar, 'connector': activeOracleInstance.connector, 'cbAddress': activeOracleInstance.account, 'http_myid': myid, 'contract_myid': myIdInitial, 'query_delay': time, 'query_arg': JSON.stringify(formula), 'query_datasource': ds, 'contract_address': cAddr, 'event_tx': eventTx, 'block_tx_hash': blockHashTx, 'proof_type': proofType, 'gas_limit': gasLimit}, function (err, res) {
        if (err !== null) logger.error('query db create error',err)
        if (queryCheckUnixTime <= 0) {
          logger.info('checking HTTP query ' + myid + ' status in 0 seconds')
          checkQueryStatus(myid, myIdInitial, cAddr, proofType, gasLimit)
        } else {
          var targetDate = new Date(queryCheckUnixTime * 1000)
          processQueryInFuture(targetDate, {'active': true, 'callback_complete': false, 'retry_number': 0, 'target_timestamp': queryCheckUnixTime, 'oar': activeOracleInstance.oar, 'connector': activeOracleInstance.connector, 'cbAddress': activeOracleInstance.account, 'http_myid': myid, 'contract_myid': myIdInitial, 'query_delay': time, 'query_arg': JSON.stringify(formula), 'query_datasource': ds, 'contract_address': cAddr, 'event_tx': eventTx, 'block_tx_hash': blockHashTx, 'proof_type': proofType, 'gas_limit': gasLimit})
        }
        myIdList = arrayCleanUp(myIdList)
      })
    })
  } catch (e) {
    logger.error('handle log error ', e)
  }
}

function arrayCleanUp (array) {
  if (Object.keys(array).length > 15) {
    array.splice(0, array.length - 15)
    return array
  } else return array
}

function getQueryUnixTime (time, unixTime) {
  if (time < unixTime && time > 1420000000) return 0
  if (time < 1420000000 && time > 5) return toPositiveNumber(unixTime + time)
  if (time > 1420000000) return toPositiveNumber(time)
  return 0
}

function toPositiveNumber (number) {
  if (number < 0) return 0
  else return parseInt(number)
}

function checkQueryStatus (myid, myIdInitial, contractAddress, proofType, gasLimit) {
  if (typeof myid === 'undefined') return logger.error('checkQueryStatus error, http myid provided is invalid')
  logger.info('checking HTTP query', myid, 'status every 5 seconds...')
  var interval = setInterval(function () {
    if (callbackRunning === true) return
    queryStatus(myid, function (data) {
      logger.info(myid, 'HTTP query result: ', data)
      if (data.result.active === true) return
      var dataProof = null
      if (checkErrors(data) === true) {
        // queryDoc.active = false;
        // updateQueriesDB(queryDoc);
        clearInterval(interval)
        var dataResult = null
        var proofResult = null
        if ('checks' in data.result) {
          var lastQueryCheck = data.result.checks[data.result.checks.length - 1]
          var queryResultWithError = lastQueryCheck.results[lastQueryCheck.results.length - 1]
          var queryProofWithError = data.result.checks[data.result.checks.length - 1]['proofs'][0]
          if (queryResultWithError !== null) dataResult = queryResultWithError
          if (queryProofWithError !== null) proofResult = getProof(queryProofWithError, proofType)
        }
        queryComplete(gasLimit, myIdInitial, dataResult, proofResult, contractAddress, proofType)
        return
      }
      if (!('checks' in data.result)) return
      else clearInterval(interval)
      var lastCheck = data.result.checks[data.result.checks.length - 1]
      var queryResult = lastCheck.results[lastCheck.results.length - 1]
      var dataRes = queryResult
      if (bridgeUtil.containsProof(proofType)) {
        dataProof = getProof(data.result.checks[data.result.checks.length - 1]['proofs'][0], proofType)
      }
      // queryDoc.active = false;
      // updateQueriesDB(queryDoc);
      queryComplete(gasLimit, myIdInitial, dataRes, dataProof, contractAddress, proofType)
    })
  }, 5000)
}

function getProof (proofContent, proofType) {
  if (!bridgeUtil.containsProof(proofType)) return null
  if (proofContent === null) {
    return new Buffer('')
  } else if (typeof proofContent === 'object') {
    if (typeof proofContent.type !== 'undefined' && typeof proofContent.value !== 'undefined') {
      return new Buffer(proofContent.value)
    }
  } else return proofContent
}

function queryComplete (gasLimit, myid, result, proof, contractAddr, proofType) {
  // if(/*|| queryDoc.callback_complete==true*/) return;
  try {
    callbackRunning = true
    // queryDoc.callback_complete = true;
    // updateQueriesDB(queryDoc);
    if (typeof gasLimit === 'undefined' || typeof myid === 'undefined' || typeof contractAddr === 'undefined' || typeof proofType === 'undefined') {
      return queryCompleteErrors('queryComplete error, __callback arguments are empty')
    }
    Query.findOne({where: {'contract_myid': myid}}, function (err, res) {
      if (err) return queryCompleteErrors('queryComplete find query error', err)
      if (res === null) return queryCompleteErrors('queryComplete error, query with contract myid ' + myid + ' not found in database')
      if (res.callback_complete === true) return queryCompleteErrors('queryComplete error, __callback for contract myid', myid, 'was already called before, skipping...')
      var callbackData = bridgeUtil.callbackTxEncode(myid, result, proof, proofType)
      activeOracleInstance.sendTx({'from': activeOracleInstance.account, 'to': bridgeCore.ethUtil.addHexPrefix(contractAddr), 'gas': gasLimit, 'data': callbackData}, function (err, contract) {
        var callbackObj = {'myid': myid, 'result': result, 'proof': proof}
        if (err) {
          updateQuery(callbackObj, null, err)
          return logger.error('callback tx error, contract myid: ' + myid, err)
        }
        logger.info('Contract ' + contractAddr + ' __callback called', callbackObj)
        updateQuery(callbackObj, contract, null)
      })
    })
  } catch (e) {
    logger.error('queryComplete error ', e)
  }
}

function manageErrors (err) {
  if (err.message.match(/Invalid JSON RPC response/)) {
    clearInterval(reorgInterval)
    // retry after 1 minute
    logger.warn('JSON RPC error, trying to re-connect every 30 seconds')
    var nodeStatusCheck = setInterval(function () {
      try {
        var nodeStatus = bridgeCore.web3.eth.blockNumber
        if (nodeStatus > 0) {
          clearInterval(nodeStatusCheck)
          logger.info('json-rpc is now available')

          // fetch 'lost' queries
          if (latestBlockNumber < nodeStatus) {
            logger.info('trying to recover "lost" queries...')
            fetchLogsByBlock(latestBlockNumber, nodeStatus)
          }

          schedule.scheduleJob(new Date(parseInt(Date.now() + 5000)), function () {
            logger.info('restarting logs...')

            // chain re-org listen
            reorgListen()
          })
        }
      } catch (e) {
        if (e.message.match(/Invalid JSON RPC response/)) {
          logger.error('json rpc is not available')
        }
      }
    }, 30000)
  }
}

function queryCompleteErrors (msg, err) {
  callbackRunning = false
  if (err) {
    manageErrors(err)
    logger.error(msg, err)
  }
}

function updateQuery (callbackInfo, contract, errors) {
  var dataDbUpdate = {}
  if (errors !== null) {
    dataDbUpdate = {'query_active': false, 'callback_complete': false, '$inc': {'retry_number': 1}}
    if (!errors.message.match(/Invalid JSON RPC response/)) dataDbUpdate.callback_error = true
  } else {
    dataDbUpdate = {'query_active': false, 'callback_complete': true}
  }
  Query.update({where: {'contract_myid': callbackInfo.myid}}, dataDbUpdate, function (err, res) {
    if (err) logger.error('queries database update failed for query with contract myid', callbackInfo.myid)
    if (contract === null) {
      callbackRunning = false
      return logger.error('transaction hash not found, callback tx database not updated', contract)
    }
    CallbackTx.create({'contract_myid': callbackInfo.myid, 'tx_hash': contract.transactionHash, 'contract_address': contract.to, 'result': callbackInfo.result, 'proof': callbackInfo.proof, 'gas_limit': contract.gasUsed, 'errors': errors}, function (err, res) {
      if (err) logger.error('failed to add a new transaction to database', err)
      callbackRunning = false
    })
  })
}

function createQuery (query, callback) {
  request.post('https://api.oraclize.it/v1/query/create', {body: query, json: true, headers: { 'X-User-Agent': BRIDGE_NAME + '/' + BRIDGE_VERSION + ' (nodejs)' }}, function (error, response, body) {
    if (error) {
      logger.error('HTTP query create request error ', error)
      logger.info('re-trying to create the query again in 5 seconds...')
      schedule.scheduleJob(new Date(parseInt(Date.now() + 5000)), function () {
        var newTime = toPositiveNumber(query.when - 5)
        query.when = newTime
        createQuery(query, callback)
      })
    } else {
      if (response.statusCode === 200) {
        callback(body)
      } else console.error('UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST ' + BRIDGE_NAME.toUpperCase())
    }
  })
}

function queryStatus (queryId, callback) {
  request.get('https://api.oraclize.it/v1/query/' + queryId + '/status', {json: true, headers: { 'X-User-Agent': BRIDGE_NAME + '/' + BRIDGE_VERSION + ' (nodejs)' }}, function (error, response, body) {
    if (error) {
      logger.error('HTTP query status request error ', error)
      callback({'result': {}})
    } else {
      if (response.statusCode === 200) {
        callback(body)
      } else console.error('UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST ' + BRIDGE_NAME.toUpperCase())
    }
  })
}

function checkErrors (data) {
  try {
    if (!('result' in data)) {
      logger.error('no result')
      return false
    } else if ('checks' in data.result) {
      var lastCheck = data.result.checks[data.result.checks.length - 1]
      if (typeof lastCheck['errors'][0] !== 'undefined') {
        logger.error('HTTP query error', lastCheck.errors)
        return true
      }
    } else {
      if (data.result['errors'].length > 0) {
        logger.error('HTTP query error', data.result.errors)
        return true
      }
    }
  } catch (e) {
    logger.error('Query error', e)
    return true
  }
}
