'use strict'

const ethUtil = require('ethereumjs-util')
const ethAbi = require('ethereumjs-abi')
const multihashes = require('multihashes')
const ethWallet = require('eth-lightwallet')
const fs = require('fs')
const path = require('path')

const setCbAddressTxEncode = function (address) {
  if (ethUtil.isValidAddress(address) === false) throw new Error('Address provided is not valid')
  address = ethUtil.addHexPrefix(address)
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('setCBaddress(address)', address).toString('hex'))
}

const generateNewAddress = function (keyFile, callback) {
  const password = ethWallet.keystore.generateRandomSeed()
  ethWallet.keystore.createVault({
    password: password
  }, function (err, ks) {
    if (err) return callback(new Error(err), null)
    ks.keyFromPassword(password, function (err, pwDerivedKey) {
      if (err) return callback(new Error(err), null)
      ks.generateNewAddress(pwDerivedKey, 1)
      const generatedAddress = ethUtil.addHexPrefix(ks.getAddresses()[0])
      var keyFileContent = ''
      fs.readFile(keyFile, function read (err, data) {
        if (err) {
          if (err.code === 'ENOENT') keyFileContent = ''
        }
        keyFileContent = data
        const privateKeyExported = ks.exportPrivateKey(generatedAddress, pwDerivedKey)
        var privateToSave = [privateKeyExported]
        var accountPosition = 0
        if (keyFileContent && keyFileContent.length > 0) {
          privateToSave = privateKeyExported
          var keyObj = JSON.parse(keyFileContent.toString())
          accountPosition = keyObj.length
          keyObj.push(privateToSave)
          privateToSave = keyObj
        }
        var contentToWrite = privateToSave
        fs.writeFile(keyFile, JSON.stringify(contentToWrite), function (err) {
          if (err) callback(new Error(err), null)
          callback(null, {'success': true, 'address': generatedAddress, 'account_position': accountPosition})
        })
      })
    })
  })
}

const setAddrTxEncode = function (address) {
  if (ethUtil.isValidAddress(address) === false) throw new Error('Address provided is not valid')
  address = ethUtil.addHexPrefix(address)
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('setAddr(address)', address).toString('hex'))
}

const callbackTxEncode = function (myid, result, proof, proofType) {
  myid = standardMyid(myid)
  result = standardResult(result)
  if (containsProof(proofType) === false) {
    // return ethUtil.addHexPrefix(ethAbi.simpleEncode("__callback(bytes32, string)", [myid, result]).toString('hex'))
    return '0x27DC297E' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['bytes32', 'string'], [myid, result]).toString('hex'))
  } else {
    proof = standardProof(proof)
    // return ethUtil.addHexPrefix(ethAbi.simpleEncode("__callback(bytes32, string, bytes", [myid, result, proof]).toString('hex'))
    return '0x38BBFA50' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['bytes32', 'string', 'bytes'], [myid, result, proof]).toString('hex'))
  }
}

const containsProof = function (proofType) {
  if (ethUtil.addHexPrefix(proofType) === '0x00') return false
  else return true
}

const loadLocalFile = function (pathFile) {
  return fs.readFileSync(path.resolve(__dirname, pathFile)).toString()
}

const loadLocalJson = function (filePath) {
  return JSON.parse(loadLocalFile(filePath))
}

const saveFile = function (fileName, content) {
  fs.writeFileSync(fileName, content)
}

const saveJsonFile = function (fileName, obj) {
  if (typeof obj === 'object') obj = JSON.stringify(obj)
  saveFile(fileName, obj)
}

const standardMyid = function (myid) {
  return ethUtil.addHexPrefix(myid).toString()
}

const standardResult = function (result) {
  if (Buffer.isBuffer(result)) return result
  if (result === null) return ''
  if (typeof result === 'object') return JSON.stringify(result)
  else return result.toString()
}

const standardProof = function (proof) {
  if (proof === null || proof === '') return new Buffer('')
  if (isValidMultihash(proof)) {
    return multihashToBytes(proof)
  } else {
    if (Buffer.isBuffer(proof)) return proof
    else return new Buffer(proof)
  }
}

const multihashToBytes = function (hash) {
  return new Uint8Array(multihashes.fromB58String(hash))
}

const isValidMultihash = function (hash) {
  try {
    return typeof multihashes.validate(multihashes.fromB58String(hash)) === 'undefined' ? true : false
  } catch (e) {
    return false
  }
}

const getEventsName = function (abi) {
  var eventsInAbi = []
  if (typeof abi !== 'object') throw new Error('abi must be an object')
  for (var i = abi.length - 1; i >= 0; i--) {
    if (abi[i].type === 'event') {
      eventsInAbi.push(abi[i].name)
    }
  }
  return eventsInAbi
}

const privateToPublic = function (privateKey) {
  if (typeof privateKey !== 'string' && Buffer.isBuffer(privateKey) === false) throw new Error('Private key must string or Buffer')
  const privateKeyBuff = Buffer.isBuffer(privateKey) === true ? privateKey : new Buffer(privateKey, 'hex')
  return ethUtil.addHexPrefix(ethUtil.privateToAddress(privateKeyBuff).toString('hex'))
}

const toInt = function (hex) {
  checkString(hex)
  hex = ethUtil.addHexPrefix(hex)
  return parseInt(hex, 16)
}

const intToHex = function (number) {
  return ethUtil.addHexPrefix(ethUtil.intToHex(number))
}

const checkString = function (hex) {
  if (typeof hex !== 'string') throw new Error('hex must be string')
  return true
}

module.exports = {saveFile, saveJsonFile, getEventsName, containsProof, privateToPublic, toInt, callbackTxEncode, setCbAddressTxEncode, setAddrTxEncode, intToHex, loadLocalFile, loadLocalJson, generateNewAddress}
