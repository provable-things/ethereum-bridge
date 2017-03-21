'use-strict'

const singleton = require('pragma-singleton')
const BlockchainInterface = require('./blockchain-interface')
const bridgeUtil = require('./bridge-util')

function BridgeStats (logger) {
  this.logger = logger
  this.latestBlock = -1
  this.blockTimestamp = []
  this.nodeType = 'Unavailable'
  const self = this

  this.logger.stats('node_type:', BlockchainInterface().version.node)

  var versionMethods = ['network', 'ethereum', 'whisper']
  for (var i = 0; i < versionMethods.length; i++) {
    var versionName = versionMethods[i] + '_version:'
    try {
      self.logger.stats(versionName, BlockchainInterface().version[versionMethods[i]])
    } catch (e) {
      self.logger.stats(versionName, false)
    }
  }

  this.logger.stats('available_accounts:', BlockchainInterface().inter.accounts)
  this.logger.stats('coinbase:', BlockchainInterface().inter.coinbase)
  var isMining = BlockchainInterface().inter.mining
  this.logger.stats('is_mining:', isMining)
  if (isMining) this.logger.stats('hashrate:', BlockchainInterface().inter.hashrate)
  this.logger.stats('gasPrice:', BlockchainInterface().inter.gasPrice.toNumber())

  this.logger.stats('is_listening:', BlockchainInterface().inter.listening)
  this.logger.stats('peerCount:', BlockchainInterface().inter.peerCount)
  this.logger.stats('is_syncing:', BlockchainInterface().inter.syncing)

  this.runStats()
}

BridgeStats.prototype.runStats = function () {
  const self = this
  var filter = BlockchainInterface().inter.filter('latest')
  filter.watch(function (error, result) {
    if (error) return
    var block = BlockchainInterface().inter.getBlock(result)
    if (block === null || block.number === null) return
    if (self.latestBlock !== block.number) {
      self.blockTimestamp.push(parseInt(new Date() / 1000))
      self.logger.stats('latest_blockNumber:', block.number)
      self.logger.stats('latest_gasLimit:', block.gasLimit)
    }
    self.latestBlock = block.number
    if (self.blockTimestamp.length % 12 === 0) {
      var blockTime = bridgeUtil.averageDelta(self.blockTimestamp)
      self.logger.stats('avg_blocktime_secs:', blockTime)
    }
  })
}

module.exports = singleton(BridgeStats)
