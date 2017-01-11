'use strict'

const Web3 = require('web3')
const web3 = new Web3()
const utf8 = require('utf8')
const ethUtil = require('ethereumjs-util')
const EthTx = require('ethereumjs-tx')
const bridgeUtil = require('./bridge-util')
const underscore = require('underscore')

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

function OracleInstance (config) {
  if (!(this instanceof OracleInstance)) return new OracleInstance(config)
  this.modeAvailable = ['broadcast', 'active']
  this.mode = config.mode || 'active'
  if (this.modeAvailable.indexOf(this.mode) === -1) throw new Error('Mode invalid, available mode: ', this.modeAvailable)
  this.mainNode = config.node.main || '127.0.0.1:8545'
  connectoToNode(this.mainNode)
  this.oar = config.oar || ''
  this.connector = config.connector || ''
  this.keyFile = config.key_file || '../config/instance/keys.json'
  if (this.keyFile.substr(0, 2) === './') {
    this.keyFile = '.' + this.keyFile
  }
  this.deployGas = config.deploy_gas || 3000000
  this.defaultCallbackGas = config.callback_gas || 200000
  var configAccount = config.account || 0
  var accountInfo = getAccount(this.mode, configAccount, this.keyFile)
  this.account = accountInfo.account
  var privateKey = new Buffer(accountInfo.private_key, 'hex')
  this.privateKey = function () {
    return privateKey
  }
  this.backupNodes = config.node.backup || []
  this.defaultPathABI = '../contracts/abi/'
  this.defaultPathContractsBin = '../contracts/binary/'
  this.defaultPathContractsSol = '../contracts/ethereum-api/connectors/'
  var abiConnectorPath = this.defaultPathABI + 'oraclizeConnector.json'
  var abiOarPath = this.defaultPathABI + 'addressResolver.json'
  if (typeof config.contracts !== 'undefined') {
    abiConnectorPath = config.contracts.connector.abi
    abiOarPath = config.contracts.oar.abi
  }
  this.oraclizeConnectorABI = bridgeUtil.loadLocalJson(abiConnectorPath)
  this.oraclizeAddressResolverABI = bridgeUtil.loadLocalJson(abiOarPath)
  this.availableLogs = bridgeUtil.getEventsName(this.oraclizeConnectorABI)
  if (this.oar !== '') {
    this.connector = this.getConnectorByOAR(this.oar)
  }
  underscore.bindAll(this, 'checkTransaction', 'isOracleEvent', 'isValidOracleInstance', 'getCbAddresByConnector', 'getConnectorByOAR', 'getContractInstance', 'checkAccountBalance', 'deployOAR', 'deployConnector', 'sendTx', 'buildLocalTx', 'setCbAddress', 'setAddr')
}

const connectoToNode = function (node) {
  web3.setProvider(new web3.providers.HttpProvider(node))
}

OracleInstance.prototype.isOracleEvent = function (data) {
  if (this.availableLogs.indexOf(data.event) > -1 && data.address === this.connector) return true
  else return false
}

OracleInstance.prototype.isConnected = function () {
  try {
    return web3.isConnected()
  } catch (e) {
    return false
  }
}

OracleInstance.prototype.getCbAddresByConnector = function (connector) {
  if (ethUtil.isValidAddress(connector) === false) throw new Error('Address is not valid')
  const oraclizeConnector = ethUtil.addHexPrefix(connector)
  const cbAddressFound = web3.eth.contract(this.oraclizeConnectorABI).at(oraclizeConnector).cbAddress()
  return ethUtil.addHexPrefix(cbAddressFound)
}

OracleInstance.prototype.getConnectorByOAR = function (oar) {
  if (ethUtil.isValidAddress(oar) === false) throw new Error('Address is not valid')
  const OAR = ethUtil.addHexPrefix(oar)
  const oraclizeConnector = web3.eth.contract(this.oraclizeAddressResolverABI).at(OAR).getAddress.call()
  if (oraclizeConnector === '0x' || oraclizeConnector === null) throw new Error('Oraclize Connector not found, make sure you entered the correct OAR')
  const cbAddress = this.getCbAddresByConnector(oraclizeConnector)
  if (cbAddress === this.account) return ethUtil.addHexPrefix(oraclizeConnector)
  else throw new Error('The connector was deployed by another account,\n callback address of the deployed connector ' + cbAddress + " doesn't match with your current account " + this.account)
}

OracleInstance.prototype.isValidOracleInstance = function (oar, account) {
  try {
    oar = oar || this.oar
    account = account || this.account
    const connector = this.getConnectorByOAR(oar)
    const cbAddress = this.getCbAddresByConnector(connector)
    if (cbAddress === account) return {'success': true, 'error': null}
  } catch (e) {
    return {'success': false, 'error': e.message}
  }
}

OracleInstance.prototype.getContractInstance = function () {
  if (ethUtil.isValidAddress(this.oar) === false || ethUtil.isValidAddress(this.connector) === false || ethUtil.isValidAddress(this.account) === false) throw new Error('OAR, connector or account not valid')
  return web3.eth.contract(this.oraclizeConnectorABI).at(this.connector)
}

OracleInstance.prototype.checkAccountBalance = function () {
  return web3.eth.getBalance(ethUtil.addHexPrefix(this.account)).toNumber()
}

const getAccount = function (mode, configAccount, keyFile) {
  if (typeof configAccount !== 'string' && typeof configAccount !== 'number') throw new Error('Account must be a string or a number')
  if (mode === 'active') {
    if ((web3.eth.accounts).indexOf(configAccount) === -1 && typeof web3.eth.accounts[configAccount] === 'undefined') throw new Error('Account ', configAccount, ' not found in available accounts')
    if (typeof configAccount === 'string' && ethUtil.isValidAddress(configAccount)) {
      return {'account': ethUtil.addHexPrefix(configAccount), 'private_key': ''}
    } else {
      return {'account': ethUtil.addHexPrefix(web3.eth.accounts[configAccount]), 'private_key': ''}
    }
  } else if (mode === 'broadcast') {
    if (typeof keyFile === 'undefined') throw new Error('A key file is needed in broadcast mode')
    const privateKeyObj = bridgeUtil.loadLocalJson(keyFile)
    if (ethUtil.isValidAddress(configAccount) === false) {
      if (typeof privateKeyObj[configAccount] === 'undefined') throw new Error('Key file index not found')
      const privateKey = privateKeyObj[configAccount]
      return {'account': bridgeUtil.privateToPublic(privateKeyObj[configAccount]), 'private_key': privateKey}
    } else {
      for (var i = privateKeyObj.length - 1; i >= 0; i--) {
        var publicKey = bridgeUtil.privateToPublic(privateKeyObj[i])
        if (publicKey === configAccount) {
          const privateKey = privateKeyObj[i]
          return {'account': publicKey, 'private_key': privateKey}
        }
        if (i === 0) throw new Error('No account ', configAccount, ' found in ', keyFile)
      }
    }
  }
}

OracleInstance.prototype.buildLocalTx = function (txData) {
  const nonce = web3.eth.getTransactionCount(this.account)
  const rawTx = {
    nonce: bridgeUtil.intToHex(nonce),
    gasPrice: bridgeUtil.intToHex(web3.eth.gasPrice),
    gasLimit: bridgeUtil.intToHex(txData.gas),
    value: '0x0'
  }
  if (typeof txData.data !== 'undefined') rawTx.data = ethUtil.addHexPrefix(txData.data)
  if (typeof txData.to !== 'undefined') rawTx.to = ethUtil.addHexPrefix(txData.to)
  const tx = new EthTx(rawTx)
  tx.sign(this.privateKey())
  const serializedTx = tx.serialize().toString('hex')
  return ethUtil.addHexPrefix(serializedTx)
}

OracleInstance.prototype.deployOAR = function (callback) {
  const self = this
  const oraclizeAddressResolverBin = ethUtil.addHexPrefix(bridgeUtil.loadLocalFile(this.defaultPathContractsBin + 'addressResolver.binary'))
  this.sendTx({'from': this.account, 'data': oraclizeAddressResolverBin, 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(err, null)
    const oraclizeAddressResolverContract = contract
    if (oraclizeAddressResolverContract !== null) {
      const oraclizeAddressResolverAddress = oraclizeAddressResolverContract.contractAddress
      if (oraclizeAddressResolverAddress === null) return callback(new Error('No contract address found', null))
      self.oar = oraclizeAddressResolverAddress
      // callback(null, oraclizeAddressResolverAddress)
      self.setAddr(self.oar, self.connector, callback)
    } else callback(new Error('No contract found'), null)
  })
}

OracleInstance.prototype.setCbAddress = function (connector, cbAddress, callback) {
  this.sendTx({'from': this.account, 'to': connector, 'data': bridgeUtil.setCbAddressTxEncode(cbAddress), 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(new Error(err), null)
    if (contract === null) return callback(new Error('setCbAddress error'), null)
    callback(null, {'success': true, 'connector': connector})
  })
}

OracleInstance.prototype.setAddr = function (oar, connector, callback) {
  this.sendTx({'from': this.account, 'to': oar, 'data': bridgeUtil.setAddrTxEncode(connector), 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(new Error(err), null)
    if (contract === null) return callback(new Error('setAddr error'), null)
    callback(null, {'success': true, 'oar': oar})
  })
}

OracleInstance.prototype.deployConnector = function (callback) {
  const self = this
  const oraclizeConnectorBin = ethUtil.addHexPrefix(bridgeUtil.loadLocalFile(this.defaultPathContractsBin + 'oraclizeConnector.binary'))
  this.sendTx({'from': this.account, 'data': oraclizeConnectorBin, 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(err, null)
    const oraclizeConnectorContract = contract
    if (oraclizeConnectorContract !== null) {
      const oraclizeConnectorAddress = oraclizeConnectorContract.contractAddress
      if (oraclizeConnectorAddress === null) return callback(new Error('No contract address found', null))
      self.connector = oraclizeConnectorAddress
      // callback(null, oraclizeConnectorAddress)
      self.setCbAddress(self.connector, self.account, callback)
    } else callback(new Error('No contract found'), null)
  })
}

OracleInstance.prototype.sendTx = function (txData, callback) {
  const self = this
  if (this.mode === 'active') {
    if (typeof txData !== 'object') callback(new Error('tx data provided is not valid'), null)
    web3.eth.sendTransaction(txData, function (err, hash) {
      if (err) return callback(err, null)
      else self.checkTransaction(hash, callback)
    })
  } else if (this.mode === 'broadcast') {
    web3.eth.sendRawTransaction(this.buildLocalTx(txData), function (err, hash) {
      if (err) return callback(err, null)
      else self.checkTransaction(hash, callback)
    })
  }
}

OracleInstance.prototype.checkTransaction = function (hash, callback) {
  var counter = 0
  if (typeof hash === 'undefined') return callback(new Error('hash not found'), null)
  var txConfirmedInterval = setInterval(function () {
    try {
      const contract = web3.eth.getTransactionReceipt(hash)
      if (contract !== null) {
        clearInterval(txConfirmedInterval)
        callback(null, contract)
      } else if (counter >= 60) {
        clearInterval(txConfirmedInterval)
        callback(new Error('Timeout error'), null)
      }
    } catch (e) {
      clearInterval(txConfirmedInterval)
      return callback(e, null)
    }
    counter += 1
  }, 10000)
}

module.exports = {OracleInstance, web3, ethUtil}
