'use strict'

const singleton = require('pragma-singleton')
const Web3 = require('web3')
const web3 = new Web3()
const utf8 = require('utf8')
const ethUtil = require('ethereumjs-util')

// catch utf8-decode errors and return false to notify
web3._extend.utils.toUtf8 = function (hex) {
  var str = ''
  var i = 0
  var l = hex.length
  if (hex.substring(0, 2) === '0x') {
    i = 2
  }
  for (; i < l; i += 2) {
    var code = parseInt(hex.substr(i, 2), 16)
    if (code === 0) {
      break
    }
    str += String.fromCharCode(code)
  }
  try {
    return utf8.decode(str)
  } catch (e) {
    return false
  }
}

const BlockchainInterface = function (config) {
  this.mainNode = config.node.main || '127.0.0.1:8545'
  this.DEFAULT_GAS = config.gas_price
  this.connectoToNode(this.mainNode)
}

BlockchainInterface.prototype.inter = web3.eth
BlockchainInterface.prototype.version = web3.version

BlockchainInterface.prototype.connectoToNode = function (node) {
  web3.setProvider(new web3.providers.HttpProvider(node))
}

BlockchainInterface.prototype.getAccountNonce = function (address) {
  return web3.eth.getTransactionCount(ethUtil.addHexPrefix(address), 'pending')
}

BlockchainInterface.prototype.isConnected = function () {
  try {
    return web3.isConnected()
  } catch (e) {
    return false
  }
}

module.exports = singleton(BlockchainInterface)
