'use-strict'

const singleton = require('pragma-singleton')
const stdio = require('stdio')
const extend = Object.assign

function BridgeCliParse (config) {
  this.BLOCKCHAIN_ABBRV = config.BLOCKCHAIN_ABBRV
  this.BLOCKCHAIN_BASE_UNIT = config.BLOCKCHAIN_BASE_UNIT
  this.KEY_FILE_PATH = config.KEY_FILE_PATH
  this.BRIDGE_NAME = config.BRIDGE_NAME
  this.DEFAULT_NODE = config.DEFAULT_NODE
  this.BRIDGE_VERSION = config.BRIDGE_VERSION

  this.cliConfiguration = {
    'defaultnode': this.DEFAULT_NODE
  }
}

BridgeCliParse.prototype.getConfiguration = function () {
  var ops = stdio.getopt(this.getOptions())

  extend(this.cliConfiguration, ops)

  if (ops.version) {
    console.log('v' + this.BRIDGE_VERSION)
    process.exit(0)
  }

  if (ops.logfile) {
    if (ops.logfile.slice(-1) === '/') {
      this.cliConfiguration.logFilePath = ops.logfile + 'bridge.log'
    } else {
      this.cliConfiguration.logFilePath = ops.logfile + '/bridge.log'
    }
  } else {
    this.cliConfiguration.logFilePath = './bridge.log'
  }

  if (ops.from && ops.to) {
    if (ops.to === 'latest' || ops.from === 'latest') throw new Error('latest is not allowed')
    if (parseInt(ops.to) < parseInt(ops.from)) throw new Error('toBlock should be above fromBlock')
    this.cliConfiguration.blockRangeResume = [ops.from, ops.to]
  } else if (ops.from && !ops.to) throw new Error('--from flag requires the --to flag')
  else if (!ops.from && ops.to) throw new Error('--to flag requires the --from flag')

  if (ops['price-usd'] < 0) throw new Error('Base price should be above or equal to 0')

  if (ops['price-update-interval'] <= 9) throw new Error('Price update interval should be above 9')

  if (ops.confirmation) {
    if (ops.confirmation <= 0) throw new Error('confirmations must be > 0')
    this.cliConfiguration.confirmations = ops.confirmation
  }

  if (ops.url) {
    if (ops.port) throw new Error("--url flag doesn't accept a port")
    this.cliConfiguration.defaultnode = ops.url
  }

  if (ops.HOST) {
    this.cliConfiguration.defaultnode = ops.HOST
  }

  if (ops.port) {
    if (this.cliConfiguration.defaultnode.indexOf(':') > -1) throw new Error('port already specified')
    this.cliConfiguration.defaultnode += ':' + ops.port
  }

  if (this.cliConfiguration.defaultnode.indexOf(':') === -1) {
    this.cliConfiguration.defaultnode = 'http://' + this.cliConfiguration.defaultnode + ':8545'
  } else if (this.cliConfiguration.defaultnode.indexOf('http') === -1) {
    this.cliConfiguration.defaultnode = 'http://' + this.cliConfiguration.defaultnode
  }

  if (ops.skip) {
    this.cliConfiguration.skipQueries = true
  }

  if (this.cliConfiguration.dev) {
    this.cliConfiguration.skipQueries = true
  }

  if (ops.resume) {
    this.cliConfiguration.resumeQueries = true
  }

  if (ops.gas) {
    if (ops.gas < 1970000) {
      throw new Error('Gas amount lower than 1970000 is not allowed')
    } else if (ops.gas > 4700000) {
      throw new Error('Gas amount bigger than 4700000 is not allowed')
    } else {
      this.cliConfiguration.defaultGas = ops.gas
    }
  }

  return this.cliConfiguration
}

BridgeCliParse.prototype.getOptions = function () {
  return {
    'version': {description: 'output the current bridge version and exit'},
    'instance': {args: 1, description: 'filename of the oracle configuration file that can be found in ./config/instance/ (i.e. oracle_instance_20170322T183733.json)'},
    'oar': {key: 'o', args: 1, description: 'OAR Oraclize (address)'},
    'url': {key: 'u', args: 1, description: this.BLOCKCHAIN_ABBRV + ' node URL (default: http://' + this.DEFAULT_NODE + ')'},
    'HOST': {key: 'H', args: 1, description: this.BLOCKCHAIN_ABBRV + ' node IP:PORT (default: ' + this.DEFAULT_NODE + ')'},
    'port': {key: 'p', args: 1, description: this.BLOCKCHAIN_ABBRV + ' node localhost port (default: 8545)'},
    'account': {key: 'a', args: 1, description: 'unlocked account used to deploy Oraclize connector and OAR'},
    'broadcast': {description: 'broadcast only mode, a json key file with the private key is mandatory to sign all transactions'},
    'gas': {args: 1, description: 'change gas amount limit used to deploy contracts(in wei)', default: 3700000},
    'key': {args: 1, description: 'JSON key file path (default: ' + this.KEY_FILE_PATH + ')'},
    'dev': {description: 'Enable dev mode (skip contract myid check)'},
    'new': {description: 'Generate and save a new address in ' + this.KEY_FILE_PATH + ' file'},
    'logfile': {args: 1, description: 'bridge log file path (default: current bridge folder)'},
    'nocomp': {description: 'disable contracts compilation'},
    'forcecomp': {description: 'force contracts compilation'},
    'confirmation': {args: 1, description: 'specify the minimum confirmations to validate a transaction in case of chain re-org.', default: 12},
    'abiconn': {args: 1, description: 'Load custom connector abi interface (path)'},
    'abioar': {args: 1, description: 'Load custom oar abi interface (path)'},
    'newconn': {description: 'Generate and update the OAR with the new connector address'},
    'disable-deterministic-oar': {description: 'Disable deterministic oar', default: false},
    'update-ds': {description: 'Update every datasource price (pricing is taken from the oracle instance configuration file)'},
    'disable-price': {description: 'Disable pricing'},
    'price-usd': {args: 1, description: 'Update ' + this.BLOCKCHAIN_BASE_UNIT + '/USD base price (USD price per 1 ' + this.BLOCKCHAIN_BASE_UNIT + ')'},
    'price-update-interval': {args: 1, description: 'Set base price update interval in seconds'},
    'random-ds-update-interval': {args: 1, description: 'Set random datasource hash update interval in seconds'},
    // 'changeconn': {args:1, description: 'Provide a connector address and update the OAR with the new connector address'},
    'loadabi': {description: 'Load default abi interface (under ' + this.BRIDGE_NAME + '/contracts/abi)'},
    'from': {args: 1, description: 'fromBlock (number) to resume logs (--to is required)'},
    'to': {args: 1, description: 'toBlock (number) to resume logs (--from is required)'},
    'resume': {description: 'resume all skipped queries (note: retries will not be counted/updated)'},
    'skip': {description: 'skip all pending queries (note: retries will not be counted/updated)'},
    'loglevel': {args: 1, description: 'specify the log level', default: 'info'},
    'non-interactive': {description: 'run in non interactive mode', default: false},
    'enable-stats': {description: 'enable stats logging', default: false},
    'no-hints': {description: 'disable hints', default: false},
    'disable-reorg': {description: 'disable re-org log listen'},
    'connector-state': {args: 1, description: 'JSON file with the prevous connector state'},
    'gasprice': {args: 1, description: 'Set gas price (wei)', default: 20000000000}
  }
}

module.exports = singleton(BridgeCliParse)
