'use-strict'

const singleton = require('pragma-singleton')
const EthTx = require('ethereumjs-tx')
const ethUtil = require('ethereumjs-util')
const BlockchainInterface = require('./blockchain-interface')
const BridgeAccount = require('./bridge-account')
const bridgeUtil = require('./bridge-util')

function BridgeTxManager (config) {
  this.account = config.account
  this.mode = config.mode
  this.lastNonce = -1
  var privKey = config.private_key
  this.privateKey = function () {
    return privKey
  }
}

BridgeTxManager.prototype.buildLocalTx = function (txData) {
  var broadcastAccount = this.account
  var broadcastPrivateKey = this.privateKey()
  if (typeof txData['$temporary_account'] !== 'undefined' && txData['$temporary_account'] === true) {
    broadcastAccount = BridgeAccount().getTempAddress()
    broadcastPrivateKey = BridgeAccount().getTempPrivKey()
  }
  var nonce = BlockchainInterface().getAccountNonce(broadcastAccount)

  if (nonce === this.lastNonce && this.lastNonce >= 0) {
    nonce += 1
  }

  this.lastNonce = nonce

  const rawTx = {
    nonce: bridgeUtil.intToHex(nonce),
    gasLimit: bridgeUtil.intToHex(txData.gas),
    value: '0x0'
  }
  if (typeof txData.data !== 'undefined') rawTx.data = ethUtil.addHexPrefix(txData.data)
  if (typeof txData.to !== 'undefined') rawTx.to = ethUtil.addHexPrefix(txData.to)
  if (typeof txData.value !== 'undefined') rawTx.value = ethUtil.intToHex(txData.value)
  if (typeof txData.gasPrice !== 'undefined') rawTx.gasPrice = bridgeUtil.intToHex(txData.gasPrice)
  else rawTx.gasPrice = bridgeUtil.intToHex(BlockchainInterface().inter.gasPrice.toNumber())

  const tx = new EthTx(rawTx)
  tx.sign(broadcastPrivateKey)
  const serializedTx = tx.serialize().toString('hex')
  return ethUtil.addHexPrefix(serializedTx)
}

BridgeTxManager.prototype.sendRawTx = function (txData, callback) {
  const self = this
  BlockchainInterface().inter.sendRawTransaction(this.buildLocalTx(txData), function (err, hash) {
    if (err) return callback(err, null)
    else return self.checkTransaction(hash, txData, callback)
  })
}

BridgeTxManager.prototype.sendActiveTx = function (txData, callback) {
  const self = this
  var skipConfirmation = txData['$skip_confirmation'] || false
  if (typeof txData['$skip_confirmation'] !== 'undefined') delete txData['$skip_confirmation']
  if (typeof txData['gas_price'] !== 'undefined') delete txData['gas_price']
  BlockchainInterface().inter.sendTransaction(txData, function (err, hash) {
    if (err) return callback(err, null)
    else return self.checkTransaction(hash, skipConfirmation, callback)
  })
}

BridgeTxManager.prototype.checkTransaction = function (hash, txData, callback) {
  var counter = 0
  if (typeof hash === 'undefined') return callback(new Error('hash not found'), null)
  if (typeof txData !== 'undefined' &&
      typeof txData['$skip_confirmation'] !== 'undefined' &&
      txData['$skip_confirmation'] === true) return callback(null, {'transactionHash': ethUtil.addHexPrefix(hash), 'to': txData.to, 'gasUsed': txData.gas})
  var txConfirmedInterval = setInterval(function () {
    try {
      const contract = BlockchainInterface().inter.getTransactionReceipt(hash)
      if (contract !== null) {
        clearInterval(txConfirmedInterval)
        return callback(null, contract)
      } else if (counter >= 120) {
        clearInterval(txConfirmedInterval)
        return callback(new Error('Timeout error'), null)
      }
    } catch (e) {
      console.log(e)
      clearInterval(txConfirmedInterval)
      return callback(e, null)
    }
    counter += 1
  }, 5000)
}

BridgeTxManager.prototype.sendTx = function (txData, callback) {
  if (typeof txData !== 'object') callback(new Error('tx data provided is not valid'), null)
  txData.gasPrice = (typeof txData.gas_price === 'undefined' || txData.gas_price < 0 || txData.gas_price === null) ? BlockchainInterface().DEFAULT_GAS : txData.gas_price
  if (this.mode === 'active') {
    return this.sendActiveTx(txData, callback)
  } else if (this.mode === 'broadcast') {
    return this.sendRawTx(txData, callback)
  }
}

module.exports = singleton(BridgeTxManager)
