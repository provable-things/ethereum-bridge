#!/usr/bin/env node
var semver = require('semver')
checkVersion()
var readline = require('readline')
var i18n = require('i18n')
var schedule = require('node-schedule')
var bridgeUtil = require('./lib/bridge-util')
var BridgeCliParse = require('./lib/bridge-cli-parse')
var bridgeCore = require('./lib/bridge-core')
var BridgeAccount = require('./lib/bridge-account')
var BlockchainInterface = require('./lib/blockchain-interface')
var BridgeLogManager = require('./lib/bridge-log-manager')
var bridgeHttp = require('./lib/bridge-http')
var BridgeStats = require('./lib/bridge-stats')
var BridgeDbManagerLib = require('./lib/bridge-db-manager')
var BridgeDbManager = BridgeDbManagerLib.BridgeDbManager
var BridgeLogEvents = BridgeLogManager.events
var AddressWatcher = require('./lib/address-watcher')
var winston = require('winston')
var colors = bridgeUtil.colors
var async = require('async')
var callbackQueue = async.queue(__callbackWrapper, 2)
var logsQueue = async.queue(logsWrapper, 1)
var fs = require('fs')
var path = require('path')
var asyncLoop = require('node-async-loop')
var moment = require('moment')

var OracleInstance = bridgeCore.OracleInstance
var activeOracleInstance

var dbConfig = {
  'driver': 'tingodb',
  'database': toFullPath('./database/tingodb/')
}

i18n.configure({
  defaultLocale: 'ethereum',
  updateFiles: false,
  objectNotation: true,
  directory: toFullPath('./config/text/')
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

var CallbackTx = BridgeDbManager().CallbackTx
var BridgeCache = BridgeDbManager().cache

var mode = 'active'
var keyFilePath = toFullPath('./config/instance/keys.json')
var configFilePath = ''
var isTestRpc = false
var pricingInfo = []
var basePrice = 0
var officialOar = []
var currentInstance = 'latest'

var bridgeObj = {'BRIDGE_NAME': BRIDGE_NAME, 'BRIDGE_VERSION': BRIDGE_VERSION}

var cliOptions = {
  'BLOCKCHAIN_ABBRV': BLOCKCHAIN_ABBRV,
  'BLOCKCHAIN_BASE_UNIT': BLOCKCHAIN_BASE_UNIT,
  'KEY_FILE_PATH': keyFilePath,
  'BRIDGE_NAME': BRIDGE_NAME,
  'DEFAULT_NODE': 'localhost:8545',
  'BRIDGE_VERSION': BRIDGE_VERSION
}

BridgeCliParse(cliOptions)

var cliConfiguration = BridgeCliParse().getConfiguration()

console.log('Please wait...')

var logger = new (winston.Logger)({
  levels: bridgeUtil.getLogLevels(),
  transports: [
    new (winston.transports.Console)({
      colorize: true,
      level: bridgeUtil.parseLogLevel(cliConfiguration.loglevel),
      timestamp: function () {
        return moment().toISOString()
      },
      formatter: function (options) {
        var multiLineFmt = (k, val) =>
          (typeof val === 'string' && val.split('\n').length > 1) ? val.split('\n') : val;

        return '[' + colors.grey(options.timestamp()) + '] ' + bridgeUtil.colorize(options.level.toUpperCase()) + ' ' + (options.message ? options.message : '') +
          (options.meta && Object.keys(options.meta).length ? '\n\t' + JSON.stringify(options.meta, multiLineFmt, 4) : '')
      }
    }),
    new (winston.transports.File)({
      filename: cliConfiguration.logFilePath,
      level: 'debug'
    })
  ]
})

logger.debug('parsed options', cliConfiguration)

if (cliConfiguration.dev) {
  logger.warn('--dev mode active, contract myid checks and pending queries are skipped, use this only when testing, not in production')
}

if (cliConfiguration.broadcast) {
  mode = 'broadcast'
  try {
    var privateKeyContent = fs.readFileSync(keyFilePath)
    if (JSON.parse(privateKeyContent.toString()).length > 0) {
      if (!cliConfiguration.account) cliConfiguration.account = 0
    } else if (cliConfiguration.account) {
      cliConfiguration.new = true
      if (cliConfiguration['non-interactive'] === false) {
        logger.error('no account', cliConfiguration.account, 'found in your keys.json file, automatically removing the -a option...')
        cliConfiguration.account = null
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      cliConfiguration.new = true
      if (cliConfiguration['no-hints'] === false) logger.warn('keys.json not found, creating the new file', keyFilePath)
      try {
        bridgeUtil.saveJsonFile(keyFilePath, JSON.stringify([]))
      } catch (e) {
        logger.error('failed to save the key file', e)
      }
    }
  }
}

logger.info('you are running ' + BRIDGE_NAME, '- version: ' + BRIDGE_VERSION)
logger.info('saving logs to:', cliConfiguration.logFilePath)

var oraclizeConfiguration = {
  'context_name': bridgeUtil.getContext({'prefix': BLOCKCHAIN_ABBRV, 'random': true}),
  'latest_block_number': -1,
  'oar': cliConfiguration.oar,
  'node': {
    'main': cliConfiguration.defaultnode,
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
  'deterministic_oar': !cliConfiguration['disable-deterministic-oar'],
  'deploy_gas': parseInt(cliConfiguration.defaultGas),
  'account': cliConfiguration.account,
  'mode': mode,
  'key_file': keyFilePath,
  'gas_price': parseInt(cliConfiguration.gasprice)
}

if (cliConfiguration.abiconn || cliConfiguration.abioar) {
  if (cliConfiguration.abiconn) oraclizeConfiguration.contracts.connector.abi = toFullPath(cliConfiguration.abiconn)
  if (cliConfiguration.abioar) oraclizeConfiguration.contracts.oar.abi = toFullPath(cliConfiguration.abioar)
}

if (cliConfiguration.instance) {
  var instanceToLoad = cliConfiguration.instance
  var instances = getInstances()
  logger.debug('instances found', instances)
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
  currentInstance = instanceToLoad
} else if (!cliConfiguration.oar) {
  if (cliConfiguration.new && cliConfiguration.account) throw new Error("--new flag doesn't require the -a flag")
  if (cliConfiguration.new && cliConfiguration.broadcast) {
    bridgeUtil.generateNewAddress(keyFilePath, function (err, res) {
      if (err) throw new Error(err)
      logger.info('New address generated', res.address, 'at position: ' + res.account_position)
      oraclizeConfiguration.account = res.account_position
      startUpLog(true)
    })
  } else if (cliConfiguration.new && !cliConfiguration.broadcast) throw new Error('--new flag requires --broadcast mode')
  else startUpLog(true)
} else {
  if (cliConfiguration.new) throw new Error('cannot generate a new address if contracts are already deployed, please remove the --new flag')
  startUpLog(false, oraclizeConfiguration)
}

function getInstances () {
  var instances = fs.readdirSync(toFullPath('./config/instance/'))
  var instanceKeyIndex = instances.indexOf('keys.json')
  if (instanceKeyIndex > -1) {
    instances.splice(instanceKeyIndex, 1)
  }
  var keepFile = instances.indexOf('.keep')
  if (keepFile > -1) {
    instances.splice(keepFile, 1)
  }
  return instances
}

function toFullPath (filePath) {
  return path.join(__dirname, filePath)
}

function oracleFromConfig (config) {
  try {
    if ((pricingInfo.length > 0 && typeof config.onchain_config === 'undefined') || cliConfiguration['remote-price'] === true) {
      config.onchain_config = {}
      config.onchain_config.pricing = pricingInfo
      config.onchain_config.base_price = basePrice
    }
    config.gas_price = cliConfiguration.gasprice
    logger.debug('configuration file', config)
    activeOracleInstance = new OracleInstance(config)
    checkNodeConnection()
    activeOracleInstance.isValidOracleInstance()
    userWarning()
    logger.info('OAR found:', activeOracleInstance.oar)
    logger.info('connector found:', activeOracleInstance.connector)
    logger.info('callback address:', activeOracleInstance.account)

    if (cliConfiguration['update-ds'] === true) {
      logger.info('updating datasource pricing...')
      activeOracleInstance.multiAddDSource(activeOracleInstance.connector, config.onchain_config.pricing, function (err, res) {
        if (err) logger.error('multiAddDSource error', err)
        else logger.info('multiAddDSource correctly updated')
      })
    }

    if (!cliConfiguration.newconn) runLog()
    else {
      if (cliConfiguration['non-interactive'] === true) throw new Error('new connector is not available in non-interactive mode')
      var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      })
      rl.question('Are you sure you want to generate a new connector and update the Address Resolver? [Y/n]: ', function (answ) {
        answ = answ.toLowerCase()
        if (answ.match(/y/)) {
          rl.close()
          console.log('Please wait...')
          async.waterfall([
            function (callback) {
              activeOracleInstance.deployConnector(callback)
            },
            function setPricing (result, callback) {
              logger.info('successfully deployed a new connector', result.connector)
              oraclizeConfiguration.connector = result.connector
              if (cliConfiguration['disable-price'] === true || pricingInfo.length === 0) {
                logger.warn('skipping pricing update...')
                callback(null, null)
              } else {
                logger.info('updating connector pricing...')
                activeOracleInstance.setPricing(result.connector, callback)
              }
            },
            function updateState (result, callback) {
              logger.debug('pricing update result', result)
              if (cliConfiguration['connector-state']) {
                var contractState = JSON.parse(fs.readFileSync(cliConfiguration['connector-state']).toString())
                var addressListProof = Object.keys(contractState['addr_proofType'])
                var proofList = []
                for (var i = 0; i < addressListProof.length; i++) {
                  proofList.push(contractState['addr_proofType'][addressListProof[i]])
                }
                if (proofList.length !== addressListProof.length) throw new Error('Address list and proof list doesn\'t match')

                var addressListGasPrice = Object.keys(contractState['addr_gasPrice'])
                var gasPriceList = []
                for (var i = 0; i < addressListGasPrice.length; i++) {
                  gasPriceList.push(contractState['addr_gasPrice'][addressListGasPrice[i]])
                }
                if (gasPriceList.length !== addressListGasPrice.length) throw new Error('Address list and gasPrice list doesn\'t match')

                var addressListProofChunk = bridgeUtil.createGroupedArray(addressListProof, 100)
                var proofListChunk = bridgeUtil.createGroupedArray(proofList, 100)

                for (var i = 0; i < addressListProofChunk.length; i++) {
                  var addresses = addressListProofChunk[i]
                  addressListProofChunk[i] = []
                  addressListProofChunk[i][0] = addresses
                  addressListProofChunk[i][1] = proofListChunk[i]
                }

                asyncLoop(addressListProofChunk, function (chunk, next) {
                  activeOracleInstance.updateProofMapping(activeOracleInstance.connector, chunk[0], chunk[1], function (err, result) {
                    if (err) return next(err)
                    return next(null)
                  })
                }, function (err) {
                  if (err) logger.error('loop error', err)
                  else logger.info('proof mapping updated')
                })

                var addressListGasPriceChunk = bridgeUtil.createGroupedArray(addressListGasPrice, 100)
                var gasPriceListChunk = bridgeUtil.createGroupedArray(gasPriceList, 100)

                for (var i = 0; i < addressListGasPriceChunk.length; i++) {
                  var addresses = addressListGasPriceChunk[i]
                  addressListGasPriceChunk[i] = []
                  addressListGasPriceChunk[i][0] = addresses
                  addressListGasPriceChunk[i][1] = gasPriceListChunk[i]
                }

                asyncLoop(addressListGasPriceChunk, function (chunk, next) {
                  activeOracleInstance.updateGasPriceMapping(activeOracleInstance.connector, chunk[0], chunk[1], function (err, result) {
                    if (err) return next(err)
                    return next(null)
                  })
                }, function (err) {
                  if (err) logger.error('loop error', err)
                  else return callback(null, null)
                })
              } else return callback(null, null)
            },
            function updateOar (result, callback) {
              logger.debug('script result', result)
              logger.info('gasPrice mapping updated')
              activeOracleInstance.setAddr(activeOracleInstance.oar, activeOracleInstance.connector, callback)
            }], function (err, res) {
            if (err) throw new Error(err)
            if (res.success === true) {
              logger.info('successfully updated the Address Resolver')
              bridgeUtil.saveJsonFile(configFilePath, oraclizeConfiguration)
              runLog()
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
  BridgeDbManager().getPendingQueries(oar, cbAddress, function (err, pendingQueries) {
    if (err) logger.error('fetching queries error', err)
    else {
      logger.info('found a total of', pendingQueries.length, 'pending queries')
      if (pendingQueries.length === 0) return

      if (cliConfiguration.skipQueries === true) {
        logger.warn('skipping all pending queries')
        return
      } else if (cliConfiguration.resumeQueries === true) {
        logger.warn('forcing the resume of all pending queries')
      }
      asyncLoop(pendingQueries, function (thisPendingQuery, next) {
        if (thisPendingQuery.callback_error === true && cliConfiguration.skipQueries !== true) {
          logger.warn('skipping', thisPendingQuery.contract_myid, 'because of __callback tx error')
          return next(null)
        } else if (thisPendingQuery.retry_number < 3 || cliConfiguration.resumeQueries) {
          var targetUnix = parseInt(thisPendingQuery.target_timestamp)
          var queryTimeDiff = targetUnix < moment().unix() ? 0 : targetUnix
          logger.info('re-processing query', {'contract_address:': thisPendingQuery.contract_address, 'contact_myid': thisPendingQuery.contract_myid, 'http_myid': thisPendingQuery.http_myid})
          if (queryTimeDiff <= 0) {
            checkQueryStatus(thisPendingQuery)
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
  if (cliConfiguration['no-hints'] === false) logger.info('using ' + instanceToLoad + ' oracle configuration file')
}

function loadConfigFile (file) {
  var configFile = bridgeUtil.loadLocalJson(file)
  if (typeof configFile.mode !== 'undefined' && typeof configFile.account !== 'undefined' && typeof configFile.oar !== 'undefined' && typeof configFile.node !== 'undefined') {
    oraclizeConfiguration = configFile
    mode = configFile.mode
    cliConfiguration.defaultnode = configFile.node.main
    startUpLog(false, configFile)
  } else return logger.error(file + ' configuration is not valid')
}

function startUpLog (newInstance, configFile) {
  logger.info('using', mode, 'mode')
  logger.info('Connecting to ' + BLOCKCHAIN_ABBRV + ' node ' + cliConfiguration.defaultnode)
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
  if (cliConfiguration['no-hints'] === false) logger.warn('Using', activeOracleInstance.account, 'to query contracts on your blockchain, make sure it is unlocked and do not use the same address to deploy your contracts')
}

function checkNodeConnection () {
  if (!BlockchainInterface().isConnected()) nodeError()
  else {
    if (cliConfiguration['enable-stats'] === true) BridgeStats(logger)
    var nodeType = BlockchainInterface().version.node
    isTestRpc = !!nodeType.match(/TestRPC/i)
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
  var nodeinfo = getHostAndPort(cliConfiguration.defaultnode)
  var hostSplit = nodeinfo[0]
  var portSplit = nodeinfo[1]
  var startString = i18n.__('connection_failed_tip')
  startString = startString ? startString.replace(/@HOST/g, hostSplit).replace(/@PORT/g, portSplit).replace(/'/g, '"') : ''
  return logger.error(cliConfiguration.defaultnode + ' ' + BLOCKCHAIN_NAME + ' node not found, are you sure is it running?\n ' + startString)
}

function checkBridgeVersion (callback) {
  bridgeHttp.getPlatformInfo(bridgeObj, function (error, body) {
    logger.debug('check bridge version body result', body)
    if (error) return callback(error, null)
    try {
      var checkOutdated = bridgeUtil.checkIfOutdated(bridgeObj, body)
      if (checkOutdated === false) return callback(new Error('Bridge name not found'), null)
      var distribution = body.result.distributions[BRIDGE_NAME.toLowerCase()]
      if (typeof distribution.motd !== 'undefined' && distribution.motd.length > 0) logger.info('\n========================\n', distribution.motd, '\n========================')
      if (checkOutdated.outdated === true) {
        var latestVersion = checkOutdated.version
        logger.warn('\n************************************************************************\nA NEW VERSION OF THIS TOOL HAS BEEN DETECTED\nIT IS HIGHLY RECOMMENDED THAT YOU ALWAYS RUN THE LATEST VERSION, PLEASE UPGRADE TO ' + BRIDGE_NAME.toUpperCase() + ' ' + latestVersion + '\n************************************************************************\n')
      }
      if (typeof body.result.pricing !== 'undefined' && typeof body.result.quotes !== 'undefined') {
        basePrice = body.result.quotes[BLOCKCHAIN_ABBRV.toUpperCase()]
        var datasources = body.result.pricing.datasources
        var proofPricing = body.result.pricing.proofs
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
    } catch (e) {
      return callback(e, null)
    }
  })
}

function deployOraclize () {
  try {
    if (pricingInfo.length > 0) {
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
        if (isTestRpc && cliConfiguration['non-interactive'] === false) {
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
            logger.debug('account balance', balance)
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
      logger.debug('connector deployment result', result)
      if (cliConfiguration['disable-deterministic-oar'] === false && BlockchainInterface().getAccountNonce(BridgeAccount().getTempAddress()) === 0) logger.info('deploying the address resolver with a deterministic address...')
      else {
        if (cliConfiguration['no-hints'] === false) logger.warn('deterministic OAR disabled/not available, please update your contract with the new custom address generated')
        logger.info('deploying the address resolver contract...')
      }
      activeOracleInstance.deployOAR(callback)
    },
    function setPricing (result, callback) {
      oraclizeConfiguration.oar = result.oar
      logger.info('address resolver (OAR) deployed to:', oraclizeConfiguration.oar)
      logger.debug('OAR deployment result', result)
      if (cliConfiguration['disable-price'] === true || pricingInfo.length === 0) {
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
    logger.debug('pricing update result', result)
    oraclizeConfiguration.connector = activeOracleInstance.connector
    oraclizeConfiguration.account = activeOracleInstance.account
    logger.debug('new oracle inline configuration', oraclizeConfiguration)
    var oraclizeInstanceNewName = 'oracle_instance_' + moment().format('YYYYMMDDTHHmmss') + '.json'
    configFilePath = toFullPath('./config/instance/' + oraclizeInstanceNewName)
    currentInstance = oraclizeInstanceNewName
    try {
      bridgeUtil.saveJsonFile(configFilePath, oraclizeConfiguration)
      if (cliConfiguration['no-hints'] === false) logger.info('instance configuration file saved to ' + configFilePath)
    } catch (err) {
      if (cliConfiguration['no-hints'] === false) logger.error('instance configuration file ' + configFilePath + ' not saved', err)
    }
    runLog()
  })
}

function checkVersion () {
  var prVersion = process.version
  if (semver.lt(semver.clean(prVersion), '5.0.0')) {
    console.error('Not compatible with ' + prVersion + ' of nodejs, please use at least v5.0.0')
    console.log('exiting...')
    process.exit(1)
  }
    // only check that Node isn't below v5. Appears to work fine with v8+
  /*} else if (prVersion.substr(1, 1) > 7) {
    console.error('Not compatible with ' + prVersion + ' of nodejs, please use v6.9.1 or a lower version')
    console.log('exiting...')
    process.exit(1)
  }*/
}

function runLog () {
  if (officialOar.length === 1 && cliConfiguration['no-hints'] === false) logger.info('an "official" Oraclize address resolver was found on your blockchain:', officialOar[0], 'you can use that instead and quit the bridge')

  var checksumOar = bridgeCore.ethUtil.toChecksumAddress(activeOracleInstance.oar)
  if (checksumOar === '0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475' && !isTestRpc) logger.info('you are using a deterministic OAR, you don\'t need to update your contract')
  else console.log('\nPlease add this line to your contract constructor:\n\n' + 'OAR = OraclizeAddrResolverI(' + checksumOar + ');\n')

  logger.debug('starting the bridge log manager...')
  BridgeLogManager = BridgeLogManager.init()

  var latestBlockMemory = activeOracleInstance.latestBlockNumber

  logger.debug('latest block seen (config file)', latestBlockMemory)

  // listen for latest events
  listenToLogs()

  if (isTestRpc && !cliConfiguration.dev && cliConfiguration['no-hints'] === false) {
    logger.warn('re-org block listen is disabled while using TestRPC')
    logger.warn('if you are running a test suit with Truffle and TestRPC or your chain is reset often please use the --dev mode')
  }

  if (cliConfiguration.dev || cliConfiguration['disable-reorg'] === true) logger.warn('re-org block listen is disabled')
  else reorgListen()

  logger.info('Listening @ ' + activeOracleInstance.connector + ' (Oraclize Connector)\n')

  if (cliConfiguration['price-usd']) {
    var priceInUsd = bridgeUtil.normalizePrice(1 / cliConfiguration['price-usd'])
    activeOracleInstance.setBasePrice(activeOracleInstance.connector, priceInUsd, function (err, res) {
      if (err) return logger.error('update price error', err)
      else logger.info('base price updated to', priceInUsd, BLOCKCHAIN_BASE_UNIT)
    })
  }

  if ((cliConfiguration['price-update-interval'] && !cliConfiguration['price-usd']) || cliConfiguration['random-ds-update-interval']) fetchPlatform()

  keepNodeAlive()

  console.log('(Ctrl+C to exit)\n')

  if (!isTestRpc && !cliConfiguration.dev && latestBlockMemory !== -1) {
    latestBlockMemory += 1
    var latestBlockTemp = BlockchainInterface().inter.blockNumber
    if (latestBlockTemp > latestBlockMemory) {
      logger.info('latest block seen:', latestBlockMemory, '- processing', (latestBlockTemp - latestBlockMemory), 'new blocks')
      BridgeLogManager.fetchLogsByBlock(latestBlockMemory, latestBlockTemp)
    }
  }

  activeOracleInstance.latestBlockNumber = BlockchainInterface().inter.blockNumber

  if (cliConfiguration['oar'] || cliConfiguration['instance']) processPendingQueries()

  if (typeof cliConfiguration.blockRangeResume !== 'undefined' && cliConfiguration.blockRangeResume.length === 2) {
    setTimeout(function () {
      logger.info('resuming logs from block range:', JSON.stringify(cliConfiguration.blockRangeResume))
      BridgeLogManager.fetchLogsByBlock(parseInt(cliConfiguration.blockRangeResume[0]), parseInt(cliConfiguration.blockRangeResume[1]))
    }, 5000)
  }

  if (!isTestRpc && !cliConfiguration.dev) checkCallbackTxs()

  AddressWatcher({'address': activeOracleInstance.account, 'logger': logger, 'balance_limit': 10000000000000000})
  AddressWatcher().init()
}

function fetchPlatform () {
  var usdInterval = parseInt(cliConfiguration['price-update-interval'])
  var randomDsInterval = parseInt(cliConfiguration['random-ds-update-interval'])
  var intervalArr = []
  if (!isNaN(usdInterval)) { intervalArr.push(usdInterval) }
  if (!isNaN(randomDsInterval)) { intervalArr.push(randomDsInterval) }

  var seconds = Math.min(...intervalArr)

  if (isNaN(seconds) || seconds <= 1) return

  setInterval(function () {
    bridgeHttp.getPlatformInfo(bridgeObj, function (error, body) {
      if (error) return
      logger.debug('fetch platform result', body)
      BridgeCache.set('platform_info', body.result, 0)
    })
  }, seconds * 1000)
  setTimeout(function () {
    if (cliConfiguration['random-ds-update-interval']) randDsHashUpdater(cliConfiguration['random-ds-update-interval'])
    if (cliConfiguration['price-update-interval']) priceUpdater(cliConfiguration['price-update-interval'])
  }, 3100)
}

function randDsHashUpdater (seconds) {
  setInterval(function () {
    if (BlockchainInterface().isConnected() && bridgeUtil.isSyncing(BlockchainInterface().inter.syncing) === false) {
      try {
        var body = BridgeCache.get('platform_info')
        if (typeof body.datasources === 'undefined') return
        var hashList = body.datasources.random.sessionPubKeysHash
        var hashListInCache = BridgeCache.get('sessionPubKeysHash')
        logger.debug('hash list cache', hashListInCache, 'hash list from API', hashList)
        if (bridgeUtil.compareObject(hashListInCache, hashList)) return
        BridgeCache.set('sessionPubKeysHash', hashList, 0)
        activeOracleInstance.updateRandDsHash(activeOracleInstance.connector, hashList, function (err, res) {
          if (err) return logger.error('update random ds hash error', err)
          else logger.info('random datasource hash list updated to:', hashList)
        })
      } catch (e) {
        logger.error('random ds hash failed to update', e)
      }
    }
  }, seconds * 1000)
}

function priceUpdater (seconds) {
  setInterval(function () {
    if (BlockchainInterface().isConnected() && bridgeUtil.isSyncing(BlockchainInterface().inter.syncing) === false) {
      try {
        var body = BridgeCache.get('platform_info')
        if (typeof body.quotes === 'undefined') return
        var priceInUsd = body.quotes.ETH
        if (BridgeCache.get('baseprice') === priceInUsd) return
        BridgeCache.set('baseprice', priceInUsd, 0)
        activeOracleInstance.setBasePrice(activeOracleInstance.connector, priceInUsd, function (err, res) {
          if (err) return logger.error('update price error', err)
          else logger.info('base price updated to', priceInUsd, BLOCKCHAIN_BASE_UNIT)
        })
      } catch (e) {
        logger.error('baseprice failed to update', e)
      }
    }
  }, seconds * 1000)
}

function processQueryInFuture (date, query) {
  logger.info('checking HTTP query ' + query.http_myid + ' status on ' + date)
  schedule.scheduleJob(date, function () {
    checkQueryStatus(query)
  })
}

function reorgListen () {
  try {
    if (isTestRpc) return
    var startingBlock = BlockchainInterface().inter.blockNumber
    var initialBlock = startingBlock - (cliConfiguration.confirmations * 2)
    var prevBlock = -1
    var latestBlock = -1
    logger.debug('running reorgListen')
    setInterval(function () {
      try {
        if (initialBlock < 0) initialBlock = 0
        logger.debug('reorg block target: ' + initialBlock)
        latestBlock = BlockchainInterface().inter.blockNumber
        if (prevBlock === -1) prevBlock = latestBlock
        if (latestBlock > prevBlock && prevBlock !== latestBlock && (latestBlock - initialBlock) > cliConfiguration.confirmations) {
          if (!BlockchainInterface().isConnected()) return
          prevBlock = latestBlock
          logger.debug('reorg, fetching logs from-to: ' + initialBlock)
          BridgeLogManager.fetchLogsByBlock(initialBlock, initialBlock)
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
    if (typeof log !== 'undefined') logsQueue.push(log)
  })

  BridgeLogEvents.on('log-err', function (err) {
    if (typeof err !== 'undefined') manageErrors(err)
  })

  BridgeLogManager.watchEvents()
}

function keepNodeAlive () {
  setInterval(function () {}, (1000 * 60) * 60)
}

function logsWrapper (data, callback) {
  manageLog(data)
  setTimeout(function () {
    callback()
  }, 250)
}

function manageLog (data) {
  try {
    logger.debug('manageLog, raw log:', data)
    if (typeof data === 'undefined') return logger.error('log error ' + data)
    var contractMyid = data.args['cid'] || data['parsed_logs']['contract_myid']
    BridgeDbManager().isAlreadyProcessed(contractMyid, function (err, isProcessed) {
      if (err) isProcessed = false
      logger.debug('mangeLog isProcessed: ' + isProcessed)
      if (cliConfiguration.dev === true) return handleLog(data)
      if (isProcessed === false) {
        if (activeOracleInstance.isOracleEvent(data)) {
          logger.debug('cache content', BridgeCache.get(contractMyid))
          if (cliConfiguration.dev !== true && BridgeCache.get(contractMyid) === true) return
          BridgeCache.set(contractMyid, true)
          logger.debug('cache content after', BridgeCache.get(contractMyid))
          if (typeof data.removed !== 'undefined' && data.removed === true) return logger.error('this log was removed because of orphaned block, rejected tx or re-org, skipping...')
          if ((typeof data.malformed !== 'undefined' && data.malformed === true) || typeof data.parsed_log === 'undefined') return logger.error('malformed log, skipping...')
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

function handleLog (log) {
  try {
    logger.info('new ' + log.event + ' event', log)
    var contractMyid = log['parsed_log']['contract_myid']
    var blockNumber = BlockchainInterface().inter.blockNumber
    if (blockNumber > activeOracleInstance.latestBlockNumber) activeOracleInstance.latestBlockNumber = blockNumber
    var eventTx = log['transactionHash']
    var blockHashTx = log['blockHash']
    var contractAddress = log['parsed_log']['contract_address']
    var datasource = log['parsed_log']['datasource']
    var formula = log['parsed_log']['formula']
    var time = log['parsed_log']['timestamp']
    var gasLimit = log['parsed_log']['gaslimit']
    var proofType = log['parsed_log']['proofType']
    var gasPrice = log['parsed_log']['gasPrice'] || null

    var unixTime = moment().unix()
    if (!bridgeUtil.isValidTime(time, unixTime)) return logger.error('the query is too far in the future, skipping log...')

    var query = {
      'when': time,
      'datasource': datasource,
      'query': formula,
      'id2': bridgeCore.ethUtil.stripHexPrefix(contractMyid),
      'proof_type': bridgeUtil.toInt(proofType),
      'context': {
        'name': oraclizeConfiguration.context_name,
        'protocol': BLOCKCHAIN_ABBRV.toLowerCase(),
        'type': 'blockchain',
        'relative_timestamp': log['block_timestamp']
      }
    }
    createQuery(query, function (data) {
      if (typeof data !== 'object' || typeof data.result === 'undefined' || typeof data.result.id === 'undefined') return logger.error('no HTTP myid found, skipping log...')
      var httpMyid = data.result.id
      logger.info('new HTTP query created, id: ' + httpMyid)
      var queryCheckUnixTime = bridgeUtil.getQueryUnixTime(time, unixTime)
      var newQueryObj = {
        'target_timestamp': queryCheckUnixTime,
        'oar': activeOracleInstance.oar,
        'connector': activeOracleInstance.connector,
        'cbAddress': activeOracleInstance.account,
        'http_myid': httpMyid,
        'contract_myid': contractMyid,
        'query_delay': time,
        'query_arg': JSON.stringify(formula),
        'query_datasource': datasource,
        'contract_address': contractAddress,
        'event_tx': eventTx,
        'block_tx_hash': blockHashTx,
        'proof_type': proofType,
        'gas_limit': gasLimit,
        'gas_price': gasPrice
      }

      BridgeDbManager().createDbQuery(newQueryObj, function (err, res) {
        if (err !== null) logger.error('query db create error', err)
        if (queryCheckUnixTime <= 0) {
          logger.info('checking HTTP query ' + httpMyid + ' status in 0 seconds')
          var queryObj = {
            'http_myid': httpMyid,
            'contract_myid': contractMyid,
            'contract_address': contractAddress,
            'proof_type': proofType,
            'gas_limit': gasLimit,
            'gas_price': gasPrice
          }
          checkQueryStatus(queryObj)
        } else {
          var targetDate = moment(queryCheckUnixTime, 'X').toDate()
          processQueryInFuture(targetDate, {
            'active': true,
            'callback_complete': false,
            'retry_number': 0,
            'target_timestamp': queryCheckUnixTime,
            'oar': activeOracleInstance.oar,
            'connector': activeOracleInstance.connector,
            'cbAddress': activeOracleInstance.account,
            'http_myid': httpMyid,
            'contract_myid': contractMyid,
            'query_delay': time,
            'query_arg': JSON.stringify(formula),
            'query_datasource': datasource,
            'contract_address': contractAddress,
            'event_tx': eventTx,
            'block_tx_hash': blockHashTx,
            'proof_type': proofType,
            'gas_limit': gasLimit,
            'gas_price': gasPrice
          })
        }
      })
    })
  } catch (e) {
    logger.error('handle log error ', e)
  }
}

function checkQueryStatus (queryObj) {
  var myid = queryObj.http_myid
  var myIdInitial = queryObj.contract_myid
  var contractAddress = queryObj.contract_address
  var proofType = queryObj.proof_type
  var gasLimit = queryObj.gas_limit

  var forceQuery = queryObj.force_query || false

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
      var queryComplObj = {
        'contract_myid': myIdInitial,
        'proof_type': proofType,
        'contract_address': contractAddress,
        'gas_limit': gasLimit,
        'gas_price': queryObj.gas_price,
        'force_query': forceQuery
      }
      if (bridgeUtil.checkErrors(data) === true) {
        logger.error('HTTP query error', bridgeUtil.getQueryError(data))
        clearInterval(interval)
        var dataResult = null
        var proofResult = null
        if ('checks' in data.result) {
          var lastQueryCheck = data.result.checks[data.result.checks.length - 1]
          var queryResultWithError = lastQueryCheck.results[lastQueryCheck.results.length - 1]
          var queryProofWithError = data.result.checks[data.result.checks.length - 1]['proofs'][0]
          if (queryResultWithError !== null) dataResult = queryResultWithError
          if (queryProofWithError !== null) proofResult = bridgeUtil.getProof(queryProofWithError, proofType)
        }
        queryComplObj.result = dataResult
        queryComplObj.proof_content = proofResult
        queryComplete(queryComplObj)
        return
      }
      if (!('checks' in data.result)) return
      else clearInterval(interval)
      var lastCheck = data.result.checks[data.result.checks.length - 1]
      var queryResult = lastCheck.results[lastCheck.results.length - 1]
      var dataRes = queryResult
      if (bridgeUtil.containsProof(proofType)) {
        dataProof = bridgeUtil.getProof(data.result.checks[data.result.checks.length - 1]['proofs'][0], proofType)
      }
      queryComplObj.result = dataRes
      queryComplObj.proof_content = dataProof
      queryComplete(queryComplObj)
    })
  }, 5000)
}

function queryComplete (queryComplObj) {
  try {
    var result = queryComplObj.result
    var proof = queryComplObj.proof_content
    var contractAddr = queryComplObj.contract_address
    var proofType = queryComplObj.proof_type
    var myid = queryComplObj.contract_myid
    var gasLimit = queryComplObj.gas_limit
    var gasPrice = queryComplObj.gas_price

    if (typeof gasLimit === 'undefined' || typeof myid === 'undefined' || typeof contractAddr === 'undefined' || typeof proofType === 'undefined') {
      return queryCompleteErrors('queryComplete error, __callback arguments are empty')
    }

    checkCallbackTx(myid, function (findErr, alreadyCalled) {
      if (findErr !== null) return queryCompleteErrors(findErr)
      if (alreadyCalled === true) return logger.error('queryComplete error, __callback for contract myid', myid, 'was already called before, skipping...')
      var callbackObj = {
        'myid': myid,
        'result': result,
        'proof': proof,
        'proof_type': proofType,
        'contract_address': bridgeCore.ethUtil.addHexPrefix(contractAddr),
        'gas_limit': gasLimit,
        'gas_price': gasPrice
      }
      if (BridgeCache.get(callbackObj.myid + '__callback') === true) return
      var ttlTx = cliConfiguration.dev === true ? 1 : 100
      BridgeCache.set(callbackObj.myid + '__callback', true, ttlTx)
      logger.info('sending __callback tx...', {'contract_myid': callbackObj.myid, 'contract_address': callbackObj.contract_address})
      // Without concurrency, this sometimes never seems to reach the queue
      callbackQueue.push(callbackObj, function (err) {
        if (err) logger.error('Callback queue error', err)
      })
    })
  } catch (e) {
    logger.error('queryComplete error ', e)
  }
}

function __callbackWrapper (callbackObj, cb) {
  logger.debug('__callbackWrapper object:', callbackObj)
  activeOracleInstance.__callback(callbackObj, function (err, contract) {
    if (err) {
      updateQuery(callbackObj, null, err, cb)
      return logger.error('callback tx error, contract myid: ' + callbackObj.myid, err)
    }
    logger.info('contract ' + callbackObj.contract_address + ' __callback tx sent, transaction hash:', contract.transactionHash, callbackObj)
    updateQuery(callbackObj, contract, null, cb)
  })
}

function checkCallbackTx (myid, callback) {
  if (cliConfiguration.dev === true) return callback(null, false)
  BridgeDbManager().checkCallbackQueryStatus(myid, function (err, findObject) {
    if (err) return callback(err, null)
    logger.debug('checkCallbackTx findObject content:', findObject)
    var queryObj = findObject.query
    var callbackObj = findObject.callback
    if (typeof queryObj.callback_complete === 'undefined') return callback(new Error('queryComplete error, query with contract myid ' + myid), null)
    if (callbackObj !== null) {
      if (callbackObj.tx_hash !== null) var txContent = BlockchainInterface().inter.getTransactionReceipt(callbackObj.tx_hash)
      if (typeof callbackObj.tx_confirmed !== 'undefined') {
        if (callbackObj.tx_confirmed === false && txContent !== null) return callback(null, true)
        else return callback(null, false)
      }
    } else if (queryObj.callback_complete === true) return callback(null, true)
    else return callback(null, false)
    /* else {
      var eventTx = BlockchainInterface().inter.getTransaction(queryObj.event_tx)
      if (eventTx === null || eventTx.blockHash === null || eventTx.blockHash !== queryObj.block_tx_hash) return callback(new Error('queryComplete error, query with contract myid ' + myid + ' mismatch with block hash stored'), null)
      return callback(null, false)
    } */
  })
}

function manageErrors (err) {
  if (typeof err !== 'undefined' && typeof err.message !== 'undefined' && err.message.match(/Invalid JSON RPC response/)) {
    // retry after 1 minute
    logger.warn('JSON RPC error, trying to re-connect every 30 seconds')
    var nodeStatusCheck = setInterval(function () {
      try {
        var nodeStatus = BlockchainInterface().inter.blockNumber
        if (nodeStatus > 0) {
          clearInterval(nodeStatusCheck)
          logger.info('json-rpc is now available')

          // fetch 'lost' queries
          if (activeOracleInstance.latestBlockNumber < nodeStatus) {
            logger.info('trying to recover "lost" queries...')
            BridgeLogManager.fetchLogsByBlock(activeOracleInstance.latestBlockNumber, nodeStatus)
          }
        }
      } catch (e) {
        if (e.message.match(/Invalid JSON RPC response/)) {
          logger.error('json rpc is not available')
        }
      }
    }, 30000)
  } else logger.error(err)
}

function queryCompleteErrors (err) {
  logger.error(err)
  if (err) {
    manageErrors(err)
  }
}

function updateQuery (callbackInfo, contract, errors, callback) {
  logger.debug('update query content:', callbackInfo, contract)

  var dataDbUpdate = {}
  if (errors !== null) {
    dataDbUpdate = {'query_active': false, 'callback_complete': false, 'retry_number': 3}
    if (!errors.message.match(/Invalid JSON RPC response/)) dataDbUpdate.callback_error = true
  } else {
    dataDbUpdate = {'query_active': false, 'callback_complete': true}
  }

  if (cliConfiguration.dev === true) return callback()

  var dbUpdateObj = {
    'query': dataDbUpdate,
    'callback': {}
  }

  dbUpdateObj['callback'] = {
    'timestamp_db': moment().format('x'),
    'oar': activeOracleInstance.oar,
    'cbAddress': activeOracleInstance.account,
    'connector': activeOracleInstance.connector,
    'contract_myid': callbackInfo.myid,
    'result': callbackInfo.result,
    'proof': callbackInfo.proof,
    'errors': errors
  }

  if (contract === null) {
    dbUpdateObj['callback'].tx_hash = null
    dbUpdateObj['callback'].contract_address = null
    dbUpdateObj['callback'].gas_limit = null
  } else {
    dbUpdateObj['callback'].tx_hash = contract.transactionHash
    dbUpdateObj['callback'].contract_address = contract.to
    dbUpdateObj['callback'].gas_limit = contract.gasUsed
  }

  if (dbUpdateObj['callback'].proof && typeof dbUpdateObj['callback'].proof !== 'string') {
    dbUpdateObj['callback'].proof = ''
  }

  BridgeDbManager().updateDbQuery(callbackInfo.myid, dbUpdateObj, function (err, res) {
    if (err) logger.error(err)
    if (contract === null) logger.error('transaction hash not found, callback tx database not updated', contract)
    else BridgeCache.set('callback_' + callbackInfo.myid, BlockchainInterface().inter.blockNumber, 600)
    setTimeout(function () {
      return callback()
    }, 250)
  })
}

function createQuery (query, callback) {
  logger.debug('HTTP create query content', query)
  bridgeHttp.createQuery(query, BRIDGE_NAME + '/' + BRIDGE_VERSION + ' (nodejs)', function (error, result) {
    logger.debug('oraclize HTTP create query body response', result)
    if (error && error.fatal === false) {
      logger.error('HTTP query create request error ', error)
      logger.info('re-trying to create the query again in 20 seconds...')
      schedule.scheduleJob(moment().add(20, 'seconds').toDate(), function () {
        var newTime = bridgeUtil.toPositiveNumber(query.when - 20)
        query.when = newTime
        createQuery(query, callback)
      })
    } else if (error && error.fatal === true) return logger.error('UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST ' + BRIDGE_NAME.toUpperCase())
    else return callback(result)
  })
}

function queryStatus (queryId, callback) {
  bridgeHttp.queryStatus(queryId, BRIDGE_NAME + '/' + BRIDGE_VERSION + ' (nodejs)', function (error, result) {
    if (error && error.fatal === false) {
      logger.error('HTTP query status request error ', error)
      callback({'result': {}, 'bridge_request_error': true})
    } else if (error && error.fatal === true) return logger.error('UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST ' + BRIDGE_NAME.toUpperCase())
    else return callback(result)
  })
}

function checkCallbackTxs () {
  setInterval(function () {
    logger.debug('checking invalid __callback transactions')
    if (!activeOracleInstance.oar || !activeOracleInstance.account || !activeOracleInstance.connector) return
    if (BlockchainInterface().isConnected() && bridgeUtil.isSyncing(BlockchainInterface().inter.syncing) === false) {
      CallbackTx.find({'where': {'tx_confirmed': false, 'oar': activeOracleInstance.oar, 'cbAddress': activeOracleInstance.account}}, function (err, res) {
        if (err) return logger.error('failed to fetch callback tx', err)
        logger.debug('__callback transactions list:', res)
        if (res.length === 0) return
        asyncLoop(res, function (transaction, next) {
          if (transaction.tx_hash === null) return next(null)
          var txContent = BlockchainInterface().inter.getTransactionReceipt(transaction.tx_hash)
          if (txContent !== null) {
            var newCallbackUpdate = {'$set': {'tx_confirmed': true, 'tx_confirmed_block_hash': txContent.blockHash}}
            CallbackTx.update({where: {'tx_hash': transaction.tx_hash}}, newCallbackUpdate, function (errUpdate, resUpdate) {
              if (errUpdate) return next(errUpdate)
              logger.info('transaction hash', transaction.tx_hash, 'was confirmed in block', txContent.blockHash)
              return next(null)
            })
          } else if ((moment().format('x') - transaction.timestamp_db) > 300000) {
            BridgeDbManager().getOneQuery(transaction.contract_myid, function (errQuery, contractInfo) {
              if (errQuery) return next(errQuery)
              txContent = BlockchainInterface().inter.getTransactionReceipt(transaction.tx_hash) // check again
              if (contractInfo === null || txContent !== null) return next(null)
              var callbackTxCache = BridgeCache.get('callback_' + transaction.contract_myid)
              logger.debug('callback tx cache content: ' + callbackTxCache)
              if (callbackTxCache !== undefined && BlockchainInterface().inter.blockNumber <= callbackTxCache) return next(null)
              logger.warn('__callback transaction', transaction.tx_hash, 'not confirmed after 5 minutes, resuming query with contract myid', contractInfo.contract_myid)
              contractInfo.force_query = true
              BridgeCache.set('callback_' + transaction.contract_myid, BlockchainInterface().inter.blockNumber, 600)
              CallbackTx.update({where: {'tx_hash': transaction.tx_hash}}, {'$set': {'timestamp_db': moment().format('x')}}, function (errUpdate, resUpdate) {
                setTimeout(function () {
                  checkQueryStatus(contractInfo)
                  return next(null)
                }, 1000)
              })
            })
          } else return next(null)
        }, function (err) {
          if (err) logger.error('check callback txs error', err)
        })
      })
    }
  }, 60000)
}

process.on('exit', function () {
  if (typeof activeOracleInstance !== 'undefined' &&
   activeOracleInstance.connector &&
   activeOracleInstance.oar &&
   activeOracleInstance.account) {
    var oracleInstancePath = path.resolve(toFullPath('./config/instance/'), currentInstance)
    var oracleInstanceTemp = JSON.parse(fs.readFileSync(oracleInstancePath).toString())
    oracleInstanceTemp.latest_block_number = activeOracleInstance.latestBlockNumber
    fs.writeFileSync(oracleInstancePath, JSON.stringify(oracleInstanceTemp, null, 4))
    if (cliConfiguration['no-hints'] === false) console.log('To load this instance again: ethereum-bridge --instance ' + currentInstance)
  }
  console.log('Exiting...')
})
