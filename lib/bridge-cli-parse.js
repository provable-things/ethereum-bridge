'use-strict'

const singleton = require('pragma-singleton')

function BridgeCliParse (config) {
  this.BLOCKCHAIN_ABBRV = config.BLOCKCHAIN_ABBRV
  this.BLOCKCHAIN_BASE_UNIT = config.BLOCKCHAIN_BASE_UNIT
  this.KEY_FILE_PATH = config.KEY_FILE_PATH
  this.BRIDGE_NAME = config.BRIDGE_NAME
  this.DEFAULT_NODE = config.DEFAULT_NODE
  this.DEFAULT_GAS_LIMIT = config.DEFAULT_GAS_LIMIT
}

BridgeCliParse.prototype.getOptions = function () {
  return {
    'instance': {args: 1, description: 'filename of the oracle configuration file that can be found in ./config/instance/ (i.e. oracle_instance_20170322T183733.json)'},
    'oar': {key: 'o', args: 1, description: 'OAR Oraclize (address)'},
    'url': {key: 'u', args: 1, description: this.BLOCKCHAIN_ABBRV + ' node URL (default: http://' + this.DEFAULT_NODE + ')'},
    'HOST': {key: 'H', args: 1, description: this.BLOCKCHAIN_ABBRV + ' node IP:PORT (default: ' + this.DEFAULT_NODE + ')'},
    'port': {key: 'p', args: 1, description: this.BLOCKCHAIN_ABBRV + ' node localhost port (default: 8545)'},
    'account': {key: 'a', args: 1, description: 'unlocked account used to deploy Oraclize connector and OAR'},
    'broadcast': {description: 'broadcast only mode, a json key file with the private key is mandatory to sign all transactions'},
    'gas': {args: 1, description: 'change gas amount limit used to deploy contracts(in wei) (default: ' + this.DEFAULT_GAS_LIMIT + ')'},
    'key': {args: 1, description: 'JSON key file path (default: ' + this.KEY_FILE_PATH + ')'},
    'dev': {description: 'Enable dev mode (skip contract myid check)'},
    'new': {description: 'Generate and save a new address in ' + this.KEY_FILE_PATH + ' file'},
    'logfile': {args: 1, description: 'bridge log file path (default: current bridge folder)'},
    'nocomp': {description: 'disable contracts compilation'},
    'forcecomp': {description: 'force contracts compilation'},
    'confirmation': {args: 1, description: 'specify the minimum confirmations to validate a transaction in case of chain re-org. (default: 12)'},
    'abiconn': {args: 1, description: 'Load custom connector abi interface (path)'},
    'abioar': {args: 1, description: 'Load custom oar abi interface (path)'},
    'newconn': {description: 'Generate and update the OAR with the new connector address'},
    'disable-deterministic-oar': {description: 'Disable deterministic oar'},
    'update-ds': {description: 'Update datasource price (pricing is taken from the oracle instance configuration file)'},
    'update-price': {description: 'Update base price (pricing is taken from the oracle instance configuration file)'},
    'remote-price': {description: 'Use the remote API to get the pricing info'},
    'disable-price': {description: 'Disable pricing'},
    'price-usd': {args: 1, description: 'Set ' + this.BLOCKCHAIN_BASE_UNIT + '/USD base price (USD price per 1 ' + this.BLOCKCHAIN_BASE_UNIT + ')'},
    'price-update-interval': {args: 1, description: 'Set base price update interval in seconds'},
    // 'changeconn': {args:1, description: 'Provide a connector address and update the OAR with the new connector address'},
    'loadabi': {description: 'Load default abi interface (under ' + this.BRIDGE_NAME + '/contracts/abi)'},
    'from': {args: 1, description: 'fromBlock (number) to resume logs (--to is required)'},
    'to': {args: 1, description: 'toBlock (number) to resume logs (--from is required)'},
    'resume': {description: 'resume all skipped queries (note: retries will not be counted/updated)'},
    'skip': {description: 'skip all pending queries (note: retries will not be counted/updated)'},
    'loglevel': {args: 1, description: 'specify the log level', default: 'info'},
    'non-interactive': {description: 'run in non interactive mode', default: false},
    'enable-stats': {description: 'enable stats logging', default: false},
    'no-hints': {description: 'disable hints', default: false}
  }
}

module.exports = singleton(BridgeCliParse)
