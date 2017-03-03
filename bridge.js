#!/usr/bin/env node
checkVersion()
var stdio = require('stdio')
var request = require('request')
var readline = require('readline')
var i18n = require('i18n')
var versionCompare = require('compare-versions')
var schedule = require('node-schedule')
var bridgeUtil = require('./lib/bridge-util')
var bridgeCore = require('./lib/bridge-core')
var BridgeAccount = require('./lib/bridge-account')
var BlockchainInterface = require('./lib/blockchain-interface')
var BridgeLogManager = require('./lib/bridge-log-manager')
var BridgeDbManager = require('./lib/bridge-db-manager').BridgeDbManager
var BridgeLogEvents = BridgeLogManager.events
var winston = require('winston')
var colors = require('colors/safe')
var async = require('async')
var fs = require('fs')
var cbor = require('cbor')
var path = require('path')
var asyncLoop = require('node-async-loop')
var moment = require('moment')

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

var dbConfig = {
  'driver': 'tingodb',
  'database': path.resolve(__dirname, './database/tingodb/')
}

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

if (!fs.existsSync(dbConfig.database)) {
  fs.mkdirSync(dbConfig.database)
}

dbConfig['BRIDGE_VERSION'] = BRIDGE_VERSION

BridgeDbManager(dbConfig)

var Query = BridgeDbManager().Query
var CallbackTx = BridgeDbManager().CallbackTx

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
var reorgRunning = false
var latestBlockNumber = -1
var isTestRpc = false
var reorgInterval = []
var blockRangeResume = []
var pricingInfo = []
var officialOar = []
var basePrice = 0 // in ETH

var ops = stdio.getopt({
  'instance': {args: 1, description: 'filename of the oracle configuration file that can be found in ./config/instance/ (i.e. oracle_instance_148375903.json)'},
  'oar': {key: 'o', args: 1, description: 'OAR Oraclize (address)'},
  'url': {key: 'u', args: 1, description: BLOCKCHAIN_ABBRV + ' node URL (default: http://' + defaultnode + ')'},
  'HOST': {key: 'H', args: 1, description: BLOCKCHAIN_ABBRV + ' node IP:PORT (default: ' + defaultnode + ')'},
  'port': {key: 'p', args: 1, description: BLOCKCHAIN_ABBRV + ' node localhost port (default: 8545)'},
  'account': {key: 'a', args: 1, description: 'unlocked account used to deploy Oraclize connector and OAR'},
  'broadcast': {description: 'broadcast only mode, a json key file with the private key is mandatory to sign all transactions'},
  'gas': {args: 1, description: 'change gas amount limit used to deploy contracts(in wei) (default: ' + defaultGas + ')'},
  'key': {args: 1, description: 'JSON key file path (default: ' + keyFilePath + ')'},
  'dev': {description: 'Enable dev mode (skip contract myid check)'},
  'new': {description: 'Generate and save a new address in ' + keyFilePath + ' file'},
  'logfile': {args: 1, description: 'bridge log file path (default: current bridge folder)'},
  'nocomp': {description: 'disable contracts compilation'},
  'forcecomp': {description: 'force contracts compilation'},
  'confirmation': {args: 1, description: 'specify the minimum confirmations to validate a transaction in case of chain re-org. (default: ' + confirmations + ')'},
  'abiconn': {args: 1, description: 'Load custom connector abi interface (path)'},
  'abioar': {args: 1, description: 'Load custom oar abi interface (path)'},
  'newconn': {description: 'Generate and update the OAR with the new connector address'},
  'disable-deterministic-oar': {description: 'Disable deterministic oar'},
  'update-ds': {description: 'Update datasource price (pricing is taken from the oracle instance configuration file)'},
  'update-price': {description: 'Update base price (pricing is taken from the oracle instance configuration file)'},
  'remote-price': {description: 'Use the remote API to get the pricing info'},
  'disable-price': {description: 'Disable pricing'},
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
        return moment().toISOString()
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

if (ops.dev) {
  skipQueries = true
  logger.warn('--dev mode active, contract myid checks and pending queries are skipped, use this only when testing, not in production')
}

if (ops.broadcast) {
  mode = 'broadcast'
  try {
    var privateKeyContent = fs.readFileSync(keyFilePath)
    if (JSON.parse(privateKeyContent.toString()).length > 0) {
      if (!ops.account) ops.account = 0
    } else if (ops.account) {
      ops.new = true
      logger.error('no account', ops.account, 'found in your keys.json file, automatically removing the -a option...')
      ops.account = null
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

var deterministicOar = true
if (ops['disable-deterministic-oar']) {
  deterministicOar = false
}

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
  'deterministic_oar': deterministicOar,
  'deploy_gas': defaultGas,
  'account': ops.account,
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
  if (ops.new && ops.account) throw new Error("--new flag doesn't require the -a flag")
  if (ops.new && ops.broadcast) {
    bridgeUtil.generateNewAddress(keyFilePath, function (err, res) {
      if (err) throw new Error(err)
      logger.info('New address generated', res.address, 'at position: ' + res.account_position)
      oraclizeConfiguration.account = res.account_position
      startUpLog(true)
    })
  } else if (ops.new && !ops.broadcast) throw new Error('--new flag requires --broadcast mode')
  else startUpLog(true)
} else {
  if (ops.new) throw new Error('cannot generate a new address if contracts are already deployed, please remove the --new flag')
  startUpLog(false, oraclizeConfiguration)
}

function toFullPath (filePath) {
  return path.join(__dirname, filePath)
}

function oracleFromConfig (config) {
  try {
    if ((pricingInfo.length > 0 && basePrice > 0 && typeof config.onchain_config === 'undefined') || ops['remote-price'] === true) {
      config.onchain_config = {}
      config.onchain_config.pricing = pricingInfo
      config.onchain_config.base_price = basePrice
    }
    activeOracleInstance = new OracleInstance(config)
    checkNodeConnection()
    activeOracleInstance.isValidOracleInstance()
    userWarning()
    logger.info('OAR found:', activeOracleInstance.oar)
    logger.info('connector found:', activeOracleInstance.connector)
    logger.info('callback address:', activeOracleInstance.account)

    if (ops['update-ds'] === true) {
      logger.info('updating datasource pricing...')
      activeOracleInstance.multiAddDSource(activeOracleInstance.connector, config.onchain_config.pricing, function (err, res) {
        if (err) logger.error('multiAddDSource error', err)
        else logger.info('multiAddDSource correctly updated')
        if (ops['update-price'] === true) {
          activeOracleInstance.setBasePrice(activeOracleInstance.connector, config.onchain_config.base_price, function (err, res) {
            if (err) return logger.error('update price error', err)
            else logger.info('base price updated to', config.onchain_config.base_price, BLOCKCHAIN_BASE_UNIT)
          })
        }
      })
    }

    if (ops['update-price'] === true && ops['update-ds'] !== true) {
      activeOracleInstance.setBasePrice(activeOracleInstance.connector, config.onchain_config.base_price, function (err, res) {
        if (err) return logger.error('update price error', err)
        else logger.info('base price updated to', config.onchain_config.base_price, BLOCKCHAIN_BASE_UNIT)
      })
    }

    if (!ops.newconn) runLog()
    else {
      var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      })
      rl.question('Are you sure you want to generate a new connector and update the Address Resolver? [Y/n]: ', function (answ) {
        answ = answ.toLowerCase()
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
      asyncLoop(pendingQueries, function (thisPendingQuery, next) {
        if (thisPendingQuery.callback_error === true) {
          logger.warn('skipping', thisPendingQuery.contract_myid, 'because of __callback tx error')
          return next(null)
        } else if (thisPendingQuery.retry_number < 3 || resumeQueries) {
          var targetUnix = parseInt(thisPendingQuery.target_timestamp)
          var queryTimeDiff = targetUnix < moment().unix() ? 0 : targetUnix
          logger.info('re-processing query', {'contact_address:': thisPendingQuery.contact_address, 'contact_myid': thisPendingQuery.contract_myid, 'http_myid': thisPendingQuery.http_myid})
          if (queryTimeDiff <= 0) {
            checkQueryStatus(thisPendingQuery.http_myid, thisPendingQuery.contract_myid, thisPendingQuery.contract_address, thisPendingQuery.proof_type, thisPendingQuery.gas_limit)
          } else {
            var targetDate = moment(targetUnix, 'X').toDate()
            processQueryInFuture(targetDate, thisPendingQuery)
          }
        } else {
          logger.warn('skipping', thisPendingQuery.contract_myid, 'query, exceeded 3 retries')
          return next(null)
        }
        setTimeout(function () {
          next(null)
        }, 1000)
      }, function (err) {
        if (err) logger.error('Pending query error', err)
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
    startUpLog(false, configFile)
  } else return logger.error(file + ' configuration is not valid')
}

function startUpLog (newInstance, configFile) {
  logger.info('using', mode, 'mode')
  logger.info('Connecting to ' + BLOCKCHAIN_ABBRV + ' node ' + defaultnode)
  checkBridgeVersion(function (err, res) {
    if (err) { /* skip error */ }
    try {
      if (newInstance === true) deployOraclize()
      else if (newInstance === false && typeof configFile !== 'undefined') {
        oracleFromConfig(configFile)
      } else throw new Error('failed to deploy/load oracle')
    } catch (e) {
      logger.error(e)
    }
  })
}

function userWarning () {
  logger.warn('Using', activeOracleInstance.account, 'to query contracts on your blockchain, make sure it is unlocked and do not use the same address to deploy your contracts')
}

function checkNodeConnection () {
  if (!BlockchainInterface().isConnected()) nodeError()
  else {
    var nodeType = BlockchainInterface().version.node
    isTestRpc = nodeType.match(/TestRPC/i) ? true : false
    logger.info('connected to node type', nodeType)
    try {
      for (var i = officialOar.length - 1; i >= 0; i--) {
        var oarCode = bridgeCore.ethUtil.addHexPrefix(BlockchainInterface().inter.getCode(officialOar[i], 'latest'))
        if (oarCode === null || oarCode === '0x' || oarCode === '0x0') officialOar.splice(i, 1)
      }
    } catch (e) {
      officialOar = []
    }
  }
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
  return logger.error(defaultnode + ' ' + BLOCKCHAIN_NAME + ' node not found, are you sure is it running?\n ' + startString)
}

function checkBridgeVersion (callback) {
  request.get('https://api.oraclize.it/v1/platform/info', {json: true, headers: { 'X-User-Agent': BRIDGE_NAME + '/' + BRIDGE_VERSION + ' (nodejs)' }}, function (error, response, body) {
    if (error) return callback(error, null)
    try {
      if (response.statusCode === 200) {
        if (typeof body !== 'object' || !(BRIDGE_NAME in body.result.distributions)) return callback(new Error('Bridge name not found'), null)
        var latestVersion = body.result.distributions[BRIDGE_NAME].latest.version
        if (versionCompare(BRIDGE_VERSION, latestVersion) === -1) {
          logger.warn('\n************************************************************************\nA NEW VERSION OF THIS TOOL HAS BEEN DETECTED\nIT IS HIGHLY RECOMMENDED THAT YOU ALWAYS RUN THE LATEST VERSION, PLEASE UPGRADE TO ' + BRIDGE_NAME.toUpperCase() + ' ' + latestVersion + '\n************************************************************************\n')
        }
        if (typeof body.result.pricing !== 'undefined' && typeof body.result.quotes !== 'undefined') {
          var datasources = body.result.pricing.datasources
          var proofPricing = body.result.pricing.proofs
          basePrice = body.result.quotes.ETH
          for (var i = 0; i < datasources.length; i++) {
            var thisDatasource = datasources[i]
            for (var j = 0; j < thisDatasource.proof_types.length; j++) {
              var units = thisDatasource.units + proofPricing[thisDatasource.proof_types[j]].units
              pricingInfo.push({'name': thisDatasource.name, 'proof': thisDatasource.proof_types[j], 'units': units})
              pricingInfo.push({'name': thisDatasource.name, 'proof': thisDatasource.proof_types[j] + 1, 'units': units})
            }
          }
        }
        if (typeof body.result.deployments !== 'undefined' && BLOCKCHAIN_NAME in body.result.deployments) {
          var deployments = body.result.deployments[BLOCKCHAIN_NAME]
          Object.keys(deployments).forEach(function (key) {
            officialOar.push(deployments[key]['addressResolver'])
          })
        }
        return callback(null, true)
      } else return callback(new Error(response.statusCode, 'HTTP status', null))
    } catch (e) {
      return callback(e, null)
    }
  })
}

function deployOraclize () {
  try {
    if (pricingInfo.length > 0 && basePrice > 0) {
      oraclizeConfiguration.onchain_config = {}
      oraclizeConfiguration.onchain_config.pricing = pricingInfo
      oraclizeConfiguration.onchain_config.base_price = basePrice
    }
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
        if (BlockchainInterface().version.node.match(/TestRPC/i)) {
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
                  userAccount = BlockchainInterface().inter.accounts[answ]
                  if (typeof (userAccount) === 'undefined') {
                    rl.close()
                    throw new Error('Account at index number: ' + answ + ' not found')
                  }
                  rl.question('send ' + parseFloat(amountToPay / 1e19) + ' ' + BLOCKCHAIN_BASE_UNIT + ' from account ' + userAccount + ' (index n.: ' + answ + ') to ' + activeOracleInstance.account + ' ? [Y/n]: ', function (answ) {
                    answ = answ.toLowerCase()
                    if (answ.match(/y/)) {
                      BlockchainInterface().inter.sendTransaction({'from': userAccount, 'to': activeOracleInstance.account, 'value': amountToPay})
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
      logger.info('deploying the oraclize connector contract...')
      activeOracleInstance.deployConnector(callback)
    },
    function deployOAR (result, callback) {
      logger.info('connector deployed to:', result.connector)
      if (deterministicOar === true && BlockchainInterface().getAccountNonce(BridgeAccount().getTempAddress()) === 0) logger.info('deploying the address resolver with a deterministic address...')
      else {
        logger.warn('deterministic OAR disabled/not available, please update your contract with the new custom address generated')
        logger.info('deploying the address resolver contract...')
      }
      activeOracleInstance.deployOAR(callback)
    },
    function setPricing (result, callback) {
      oraclizeConfiguration.oar = result.oar
      logger.info('address resolver (OAR) deployed to:', oraclizeConfiguration.oar)
      if (ops['disable-price'] === true || pricingInfo.length === 0 || basePrice <= 0) {
        logger.warn('skipping pricing update...')
        callback(null, null)
      } else {
        logger.info('updating connector pricing...')
        activeOracleInstance.setPricing(activeOracleInstance.connector, callback)
      }
    }
  ], function (err, result) {
    if (err) throw new Error(err)
    logger.info('successfully deployed all contracts')
    oraclizeConfiguration.connector = activeOracleInstance.connector
    oraclizeConfiguration.account = activeOracleInstance.account
    configFilePath = toFullPath('./config/instance/oracle_instance_' + moment().unix() + '.json')
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
  if (officialOar.length === 1) logger.info('an "official" Oraclize address resolver was found on your blockchain:', officialOar[0], 'you can use that instead and quit the bridge')

  var checksumOar = bridgeCore.ethUtil.toChecksumAddress(activeOracleInstance.oar)
  if (checksumOar === '0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475' && !isTestRpc) logger.info('you are using a deterministic OAR, you don\'t need to update your contract')
  else console.log('\nPlease add this line to your contract constructor:\n\n' + 'OAR = OraclizeAddrResolverI(' + checksumOar + ');\n')

  BridgeLogManager = BridgeLogManager.init()

  // listen for latest events
  listenToLogs()

  if (isTestRpc && !ops.dev) {
    logger.warn('re-org block listen is disabled while using TestRPC')
    logger.warn('if you are running a test suit with Truffle and TestRPC or your chain is reset often please use the --dev mode')
  }

  if (ops.dev) logger.warn('re-org block listen is disabled in --dev mode')
  else reorgListen()

  logger.info('Listening @ ' + activeOracleInstance.connector + ' (Oraclize Connector)\n')

  keepNodeAlive()

  console.log('(Ctrl+C to exit)\n')

  processPendingQueries()

  if (blockRangeResume.length === 2) {
    setTimeout(function () {
      logger.info('resuming logs from block range:', blockRangeResume)
      BridgeLogManager.fetchLogsByBlock(parseInt(blockRangeResume[0]), parseInt(blockRangeResume[1]))
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
    var initialBlock = from || BlockchainInterface().inter.blockNumber - (confirmations * 2)
    var prevBlock = -1
    var latestBlock = -1
    reorgRunning = false
    reorgInterval = setInterval(function () {
      try {
        if (reorgRunning === true) return
        latestBlock = BlockchainInterface().inter.blockNumber
        if (prevBlock === -1) prevBlock = latestBlock
        if (latestBlock > prevBlock && prevBlock !== latestBlock && (latestBlock - initialBlock) > confirmations) {
          prevBlock = latestBlock
          reorgRunning = true
          BridgeLogManager.fetchLogsByBlock(initialBlock, initialBlock, true)
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

function listenToLogs () {
  // listen to events
  BridgeLogEvents.on('new-log', function (log) {
    if (typeof log !== 'undefined') manageLog(log)
  })

  BridgeLogEvents.on('log-err', function (err) {
    if (typeof err !== 'undefined') manageErrors(err)
  })

  BridgeLogManager.watchEvents()
}

function keepNodeAlive () {
  setInterval(function () {}, (1000 * 60) * 60)
}

function manageLog (data) {
  try {
    if (!('args' in data)) return logger.error('no args found in log', data)
    var contractMyid = data.args['cid']
    isAlreadyProcessed(contractMyid, function (err, isProcessed) {
      if (err) isProcessed = false
      if (isProcessed === false) {
        if (activeOracleInstance.isOracleEvent(data)) {
          handleLog(data)
        } else {
          logger.warn('log with contract myid:', contractMyid, 'was triggered, but is not recognized as an oracle event, skipping event...')
        }
      } else logger.warn('log with contract myid:', contractMyid, 'was triggered, but it was already seen before, skipping event...')
    })
  } catch (e) {
    logger.error('manageLog error', e)
  }
}

function isAlreadyProcessed (contractMyid, cb) {
  if (ops.dev === true) return cb(null, false)
  isAlreadyProcessedDb(contractMyid, function (err, isProcessed) {
    if (err) return cb(err, null)
    if (isProcessed === true) return cb(null, true)
    else if (isProcessed === false && myIdList.indexOf(contractMyid) === -1) return cb(null, false)
    else return cb(null, isProcessed)
  })
}

function isAlreadyProcessedDb (contractMyid, cb) {
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
    var logObj = data
    data = logObj['args']
    var myIdInitial = data['cid']
    if (ops.dev !== true && myIdList.indexOf(myIdInitial) > -1) return
    myIdList.push(myIdInitial)
    latestBlockNumber = BlockchainInterface().inter.blockNumber
    var myid = myIdInitial
    var cAddr = data['sender']
    var ds = data['datasource']
    var formula = data['arg']
    if (logObj['event'] === 'Log1') {
      if (typeof data['arg'] === 'undefined') return logger.error('error, Log1 event is missing "arg", skipping...')
      if (data['arg'] === false) return logger.error('malformed log, skipping...')
      formula = data['arg']
    } else if (logObj['event'] === 'LogN') {
      if (typeof data['args'] === 'undefined') return logger.error('error, LogN event is missing "args", skipping...')
      if (data['args'] === false) return logger.error('malformed log, skipping...')
      formula = cbor.decodeAllSync(new Buffer(data['args'].substr(2), 'hex'))[0]
    } else if (logObj['event'] === 'Log2') {
      if (typeof data['arg1'] === 'undefined' && typeof data['arg2'] === 'undefined') return logger.error('error, Log2 event is missing "arg1" and "arg2", skipping...')
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
      if (typeof data !== 'object' || typeof data.result === 'undefined' || typeof data.result.id === 'undefined') return logger.error('no HTTP myid found, skipping log...')
      myid = data.result.id
      logger.info('new HTTP query created, id: ' + myid)
      var unixTime = moment().unix()
      var queryCheckUnixTime = getQueryUnixTime(time, unixTime)
      Query.create({'active': true, 'callback_complete': false, 'retry_number': 0, 'target_timestamp': queryCheckUnixTime, 'oar': activeOracleInstance.oar, 'connector': activeOracleInstance.connector, 'cbAddress': activeOracleInstance.account, 'http_myid': myid, 'contract_myid': myIdInitial, 'query_delay': time, 'query_arg': JSON.stringify(formula), 'query_datasource': ds, 'contract_address': cAddr, 'event_tx': eventTx, 'block_tx_hash': blockHashTx, 'proof_type': proofType, 'gas_limit': gasLimit}, function (err, res) {
        if (err !== null) logger.error('query db create error', err)
        if (queryCheckUnixTime <= 0) {
          logger.info('checking HTTP query ' + myid + ' status in 0 seconds')
          checkQueryStatus(myid, myIdInitial, cAddr, proofType, gasLimit)
        } else {
          var targetDate = moment(queryCheckUnixTime, 'X').toDate()
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
    queryStatus(myid, function (data) {
      logger.info(myid, 'HTTP query result: ', data)
      if (typeof data !== 'object' || typeof data.result === 'undefined') {
        clearInterval(interval)
        return logger.error('HTTP query status error')
      }
      if (typeof data.result.active === 'undefined' || typeof data.result.bridge_request_error !== 'undefined') return
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
      return Buffer.from(proofContent.value, 'hex')
    }
  } else return proofContent
}

function queryComplete (gasLimit, myid, result, proof, contractAddr, proofType) {
  // if(/*|| queryDoc.callback_complete==true*/) return;
  try {
    // queryDoc.callback_complete = true;
    // updateQueriesDB(queryDoc);
    if (typeof gasLimit === 'undefined' || typeof myid === 'undefined' || typeof contractAddr === 'undefined' || typeof proofType === 'undefined') {
      return queryCompleteErrors('queryComplete error, __callback arguments are empty')
    }
    checkCallbackTx(myid, function (findErr, alreadyCalled) {
      if (findErr !== null) return queryCompleteErrors(findErr)
      if (alreadyCalled === true) return queryCompleteErrors('queryComplete error, __callback for contract myid', myid, 'was already called before, skipping...')
      var callbackObj = {
        'myid': myid,
        'result': result,
        'proof': proof,
        'proof_type': proofType,
        'contract_address': bridgeCore.ethUtil.addHexPrefix(contractAddr),
        'gas_limit': gasLimit
      }
      logger.info('sending __callback tx...', {'contract_myid': callbackObj.myid, 'contract_address': callbackObj.contract_address})
      activeOracleInstance.__callback(callbackObj, function (err, contract) {
        var callbackObj = {'myid': myid, 'result': result, 'proof': proof}
        if (err) {
          updateQuery(callbackObj, null, err)
          return logger.error('callback tx error, contract myid: ' + myid, err)
        }
        logger.info('contract ' + contractAddr + ' __callback tx confirmed, transaction hash:', contract.transactionHash, callbackObj)
        updateQuery(callbackObj, contract, null)
      })
    })
  } catch (e) {
    logger.error('queryComplete error ', e)
  }
}

function checkCallbackTx (myid, callback) {
  if (ops.dev === true) return callback(null, false)
  Query.findOne({where: {'contract_myid': myid}}, function (err, res) {
    if (err) return callback(err, null)
    if (res === null) return callback(new Error('queryComplete error, query with contract myid ' + myid + ' not found in database'), null)
    if (typeof res.callback_complete === 'undefined') return callback(new Error('queryComplete error, query with contract myid ' + myid), null)
    if (res.callback_complete === true) return callback(null, true)
    else {
      var eventTx = BlockchainInterface().inter.getTransaction(res.event_tx)
      if (eventTx === null || eventTx.blockHash === null || eventTx.blockHash !== res.block_tx_hash) return callback(new Error('queryComplete error, query with contract myid ' + myid + ' mismatch with block hash stored'), null)
      return callback(null, false)
    }
  })
}

function manageErrors (err) {
  if (err.message.match(/Invalid JSON RPC response/)) {
    clearInterval(reorgInterval)
    // retry after 1 minute
    logger.warn('JSON RPC error, trying to re-connect every 30 seconds')
    var nodeStatusCheck = setInterval(function () {
      try {
        var nodeStatus = BlockchainInterface().inter.blockNumber
        if (nodeStatus > 0) {
          clearInterval(nodeStatusCheck)
          logger.info('json-rpc is now available')

          // fetch 'lost' queries
          if (latestBlockNumber < nodeStatus) {
            logger.info('trying to recover "lost" queries...')
            BridgeLogManager.fetchLogsByBlock(latestBlockNumber, nodeStatus)
          }

          schedule.scheduleJob(moment().add(5, 'seconds').toDate(), function () {
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

function queryCompleteErrors (err) {
  logger.error(err)
  if (err) {
    manageErrors(err)
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
      return logger.error('transaction hash not found, callback tx database not updated', contract)
    }
    CallbackTx.create({'contract_myid': callbackInfo.myid, 'tx_hash': contract.transactionHash, 'contract_address': contract.to, 'result': callbackInfo.result, 'proof': callbackInfo.proof, 'gas_limit': contract.gasUsed, 'errors': errors}, function (err, res) {
      if (err) logger.error('failed to add a new transaction to database', err)
    })
  })
}

function createQuery (query, callback) {
  request.post('https://api.oraclize.it/v1/query/create', {body: query, json: true, headers: { 'X-User-Agent': BRIDGE_NAME + '/' + BRIDGE_VERSION + ' (nodejs)' }}, function (error, response, body) {
    if (error) {
      logger.error('HTTP query create request error ', error)
      logger.info('re-trying to create the query again in 5 seconds...')
      schedule.scheduleJob(moment().add(5, 'seconds').toDate(), function () {
        var newTime = toPositiveNumber(query.when - 5)
        query.when = newTime
        createQuery(query, callback)
      })
    } else {
      if (response.statusCode === 200) {
        callback(body)
      } else logger.error('UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST ' + BRIDGE_NAME.toUpperCase())
    }
  })
}

function queryStatus (queryId, callback) {
  request.get('https://api.oraclize.it/v1/query/' + queryId + '/status', {json: true, headers: { 'X-User-Agent': BRIDGE_NAME + '/' + BRIDGE_VERSION + ' (nodejs)' }}, function (error, response, body) {
    if (error) {
      logger.error('HTTP query status request error ', error)
      callback({'result': {}, 'bridge_request_error': true})
    } else {
      if (response.statusCode === 200) {
        callback(body)
      } else logger.error('UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST ' + BRIDGE_NAME.toUpperCase())
    }
  })
}

function checkErrors (data) {
  try {
    if (!('result' in data)) {
      logger.error('no result')
      return false
    } else if ('checks' in data.result) {
      if (data.result.checks.length === 0) return true
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

process.on('exit', function () {
  if (typeof activeOracleInstance !== 'undefined' &&
   activeOracleInstance.connector &&
   activeOracleInstance.oar &&
   activeOracleInstance.account) {
    console.log('To load this instance again use: --instance latest')
  }
  console.log('Exiting...')
})
