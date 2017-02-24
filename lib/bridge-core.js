'use strict'

const ethUtil = require('ethereumjs-util')
const EthTx = require('ethereumjs-tx')
const bridgeUtil = require('./bridge-util')
const BridgeAccount = require('./bridge-account')
const BlockchainInterface = require('./blockchain-interface')
const singleton = require('pragma-singleton')
const async = require('async')
const path = require('path')

function OracleInstance (config) {
  this.modeAvailable = ['broadcast', 'active']
  this.mode = config.mode || 'active'
  if (this.modeAvailable.indexOf(this.mode) === -1) throw new Error('Mode invalid, available mode: ', this.modeAvailable)
  BlockchainInterface(config)
  this.oar = config.oar || ''
  this.connector = config.connector || ''
  this.keyFile = config.key_file || '../config/instance/keys.json'
  if (this.keyFile.substr(0, 2) === './') {
    this.keyFile = '.' + this.keyFile
  }
  this.deterministicOar = true
  if (typeof config.deterministic_oar !== 'undefined' && config.deterministic_oar === false) this.deterministicOar = config.deterministic_oar

  this.deployGas = config.deploy_gas || 3000000
  this.defaultCallbackGas = config.callback_gas || 200000
  var configAccount = config.account || 0
  BridgeAccount({ 'mode': this.mode, 'active_accounts': BlockchainInterface().inter.accounts, 'key_file': this.keyFile, 'account_selection': configAccount })
  var accountInfo = BridgeAccount().getAccount()
  this.account = accountInfo.account
  var privateKey = new Buffer(accountInfo.private_key, 'hex')
  this.privateKey = function () {
    return privateKey
  }
  this.backupNodes = config.node.backup || []
  this.defaultPathABI = '../contracts/abi/'
  this.defaultPathContractsBin = '../contracts/binary/'
  this.defaultPathContractsSol = '../contracts/ethereum-api/connectors/'
  var abiConnectorPath = path.join(__dirname, this.defaultPathABI + 'oraclizeConnector.json')
  var abiOarPath = path.join(__dirname, this.defaultPathABI + 'addressResolver.json')
  if (typeof config.contracts !== 'undefined') {
    abiConnectorPath = config.contracts.connector.abi
    abiOarPath = config.contracts.oar.abi
  }

  this.oraclizeConnectorContractPath = path.join(__dirname, this.defaultPathContractsBin + 'oraclizeConnector.binary')
  this.oarContractPath = path.join(__dirname, this.defaultPathContractsBin + 'addressResolver.binary')

  this.oraclizeConnectorABI = bridgeUtil.loadLocalJson(abiConnectorPath)
  this.oraclizeAddressResolverABI = bridgeUtil.loadLocalJson(abiOarPath)

  this.availableLogs = bridgeUtil.getEventsName(this.oraclizeConnectorABI)
  if (this.oar !== '') {
    this.connector = this.getConnectorByOAR(this.oar)
  }

  if (typeof config.onchain_config !== 'undefined') this.onchain_config = config.onchain_config
}

OracleInstance.prototype.isOracleEvent = function (data) {
  if (this.availableLogs.indexOf(data.event) > -1 && data.address === this.connector) return true
  else return false
}

OracleInstance.prototype.getCbAddresByConnector = function (connector) {
  if (ethUtil.isValidAddress(connector) === false) throw new Error('Address is not valid')
  const oraclizeConnector = ethUtil.addHexPrefix(connector)
  const cbAddressFound = BlockchainInterface().inter.contract(this.oraclizeConnectorABI).at(oraclizeConnector).cbAddress()
  return ethUtil.addHexPrefix(cbAddressFound)
}

OracleInstance.prototype.getConnectorByOAR = function (oar) {
  if (ethUtil.isValidAddress(oar) === false) throw new Error('Address is not valid')
  const OAR = ethUtil.addHexPrefix(oar)
  const oraclizeConnector = BlockchainInterface().inter.contract(this.oraclizeAddressResolverABI).at(OAR).getAddress.call()
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
  return BlockchainInterface().inter.contract(this.oraclizeConnectorABI).at(this.connector)
}

OracleInstance.prototype.checkAccountBalance = function () {
  return BlockchainInterface().inter.getBalance(ethUtil.addHexPrefix(this.account)).toNumber()
}

OracleInstance.prototype.buildLocalTx = function (txData) {
  var broadcastAccount = this.account
  var broadcastPrivateKey = this.privateKey()
  if (typeof txData['$temporary_account'] !== 'undefined' && txData['$temporary_account'] === true) {
    broadcastAccount = BridgeAccount().getTempAddress()
    broadcastPrivateKey = BridgeAccount().getTempPrivKey()
  }
  const nonce = BlockchainInterface().getAccountNonce(broadcastAccount)
  const rawTx = {
    nonce: bridgeUtil.intToHex(nonce),
    gasPrice: bridgeUtil.intToHex(BlockchainInterface().inter.gasPrice),
    gasLimit: bridgeUtil.intToHex(txData.gas),
    value: '0x0'
  }
  if (typeof txData.data !== 'undefined') rawTx.data = ethUtil.addHexPrefix(txData.data)
  if (typeof txData.to !== 'undefined') rawTx.to = ethUtil.addHexPrefix(txData.to)
  if (typeof txData.value !== 'undefined') rawTx.value = ethUtil.intToHex(txData.value)

  const tx = new EthTx(rawTx)
  tx.sign(broadcastPrivateKey)
  const serializedTx = tx.serialize().toString('hex')
  return ethUtil.addHexPrefix(serializedTx)
}

OracleInstance.prototype.deployOAR = function (callback) {
  const self = this
  const oraclizeAddressResolverBin = ethUtil.addHexPrefix(bridgeUtil.loadLocalFile(this.oarContractPath))

  if (this.deterministicOar === false || (this.deterministicOar === true && BlockchainInterface().getAccountNonce(BridgeAccount().getTempAddress())) > 0) {
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
  } else {
    async.waterfall([
      function (asyncCallback) {
        self.moveAccountFunds(BridgeAccount().getTempAddress(), 8027853000000001, asyncCallback)
      },
      function tempOarDeploy (result, asyncCallback) {
        self.sendRawTx({'from': self.account, 'data': oraclizeAddressResolverBin, 'gas': 324702, '$temporary_account': true}, function (err, contract) {
          if (err) return asyncCallback(err, null)
          const oraclizeAddressResolverContract = contract
          if (oraclizeAddressResolverContract !== null) {
            const oraclizeAddressResolverAddress = oraclizeAddressResolverContract.contractAddress
            if (oraclizeAddressResolverAddress === null) return asyncCallback(new Error('No contract address found', null))
            self.oar = oraclizeAddressResolverAddress
            // callback(null, oraclizeAddressResolverAddress)
            self.setAddrAndOwnership(self.account, self.oar, self.connector, asyncCallback)
          } else return asyncCallback(new Error('No contract found'), null)
        })
      }],
      function (err, result) {
        if (err) return callback(err, null)
        else return callback(null, result)
      })
  }
}

OracleInstance.prototype.moveAccountFunds = function (to, amount, callback) {
  this.sendTx({'from': this.account, 'gas': this.deployGas, 'to': to, 'value': amount}, function (err, contract) {
    if (err) return callback(err, null)
    else return callback(null, true)
  })
}

OracleInstance.prototype.setAddrAndOwnership = function (newOwner, oar, connector, deployOarCallback) {
  const self = this
  async.waterfall([
    function (callback) {
      self.changeOwner(newOwner, oar, callback)
    },
    function setNewAddr (result, callback) {
      self.setAddr(oar, connector, callback)
    }
  ],
  function (err, result) {
    if (err) return deployOarCallback(err, null)
    else return deployOarCallback(null, result)
  })
}

OracleInstance.prototype.addDSource = function (connector, datasourceObj, callback) {
  this.sendTx({'from': this.account, 'to': connector, 'data': bridgeUtil.addDSourceTxEncode(datasourceObj), 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(new Error(err), false)
    if (contract === null) return callback(new Error('addDSource error'), false)
    return callback(null, true)
  })
}

OracleInstance.prototype.multiAddDSource = function (connector, datasourceObj, callback) {
  this.sendTx({'from': this.account, 'to': connector, 'data': bridgeUtil.multiAddDSourceTxEncode(datasourceObj), 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(new Error(err), false)
    if (contract === null) return callback(new Error('multiAddDSource error'), false)
    return callback(null, true)
  })
}

OracleInstance.prototype.setBasePrice = function (connector, price, callback) {
  this.sendTx({'from': this.account, 'to': connector, 'data': bridgeUtil.setBasePriceTxEncode(price), 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(new Error(err), null)
    if (contract === null) return callback(new Error('setBasePrice error'), null)
    return callback(null, {'success': true})
  })
}

OracleInstance.prototype.setCbAddress = function (connector, cbAddress, callback) {
  this.sendTx({'from': this.account, 'to': connector, 'data': bridgeUtil.setCbAddressTxEncode(cbAddress), 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(new Error(err), null)
    if (contract === null) return callback(new Error('setCbAddress error'), null)
    return callback(null, {'success': true, 'connector': connector})
  })
}

OracleInstance.prototype.setPricing = function (connector, callback) {
  const self = this
  self.multiAddDSource(connector, self.onchain_config.pricing, function (err, res) {
    if (err) return callback(new Error(err), null)
    self.setBasePrice(connector, self.onchain_config.base_price, function (basePriceErr, res) {
      if (basePriceErr) return callback(basePriceErr, null)
      else return callback(null, {'success': true})
    })
  })
}

OracleInstance.prototype.setAddr = function (oar, connector, callback) {
  this.sendTx({'from': this.account, 'to': oar, 'data': bridgeUtil.setAddrTxEncode(connector), 'gas': this.deployGas}, function (err, contract) {
    if (err) return callback(new Error(err), null)
    if (contract === null) return callback(new Error('setAddr error'), null)
    return callback(null, {'success': true, 'oar': oar})
  })
}

OracleInstance.prototype.changeOwner = function (newOwner, oar, callback) {
  this.sendRawTx({'from': this.account, 'to': oar, 'data': bridgeUtil.changeOwnerTxEncode(newOwner), 'gas': 36913, '$temporary_account': true}, function (err, contract) {
    if (err) return callback(new Error(err), null)
    if (contract === null) return callback(new Error('changeOwner error'), null)
    return callback(null, {'success': true})
  })
}

OracleInstance.prototype.deployConnector = function (callback) {
  const self = this
  const oraclizeConnectorBin = ethUtil.addHexPrefix(bridgeUtil.loadLocalFile(this.oraclizeConnectorContractPath))
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

OracleInstance.prototype.sendRawTx = function (txData, callback) {
  const self = this
  BlockchainInterface().inter.sendRawTransaction(this.buildLocalTx(txData), function (err, hash) {
    if (err) return callback(err, null)
    else return self.checkTransaction(hash, callback)
  })
}

OracleInstance.prototype.sendActiveTx = function (txData, callback) {
  const self = this
  BlockchainInterface().inter.sendTransaction(txData, function (err, hash) {
    if (err) return callback(err, null)
    else return self.checkTransaction(hash, callback)
  })
}

OracleInstance.prototype.sendTx = function (txData, callback) {
  if (typeof txData !== 'object') callback(new Error('tx data provided is not valid'), null)
  if (this.mode === 'active') {
    return this.sendActiveTx(txData, callback)
  } else if (this.mode === 'broadcast') {
    return this.sendRawTx(txData, callback)
  }
}

OracleInstance.prototype.checkTransaction = function (hash, callback) {
  var counter = 0
  if (typeof hash === 'undefined') return callback(new Error('hash not found'), null)
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

module.exports.OracleInstance = singleton(OracleInstance)
module.exports.ethUtil = ethUtil
