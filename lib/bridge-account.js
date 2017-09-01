'use strict'

const singleton = require('pragma-singleton')
const ethUtil = require('ethereumjs-util')
const bridgeUtil = require('./bridge-util')

// used only to deploy a deterministic address resolver (OAR) (contract address = sha3(rlp.encode([normalize_address(sender), nonce]))[12:])
const OAR_ONLY_PRIV_KEY = Buffer.from('79a98ade62c92444178d73409fbce37a360b36a2483dda666d26270c8a50f5c7', 'hex')
const OAR_ONLY_ADDRESS = '0x935A0F8F4B8752C61f00D1f67b67685665ff8Cf6'

const BridgeAccount = function (config) {
  this.accountList = config.active_accounts
  this.mode = config.mode
  this.accountSel = config.account_selection
  this.keyFile = config.key_file
  this.accountInfo = retrieveAccount(this.mode, this.accountSel, this.accountList, this.keyFile)
}

BridgeAccount.prototype.getAccount = function () {
  return this.accountInfo
}

BridgeAccount.prototype.getTempAddress = function () {
  return OAR_ONLY_ADDRESS
}

BridgeAccount.prototype.getTempPrivKey = function () {
  return OAR_ONLY_PRIV_KEY
}

const retrieveAccount = function (mode, configAccount, accountList, keyFile) {
  if (typeof configAccount !== 'string' && typeof configAccount !== 'number') throw new Error('Account must be a string or a number')
  if (mode === 'active') {
    if (accountList.indexOf(configAccount) === -1 && typeof accountList[configAccount] === 'undefined') {
      throw new Error('Account ' + configAccount + ' not found in available accounts')
    }

    if (typeof configAccount === 'string' && ethUtil.isValidAddress(configAccount)) {
      return {'account': ethUtil.addHexPrefix(configAccount), 'private_key': ''}
    } else {
      return {'account': ethUtil.addHexPrefix(accountList[configAccount]), 'private_key': ''}
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

module.exports = singleton(BridgeAccount)
