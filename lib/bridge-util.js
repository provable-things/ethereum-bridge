'use strict'

const ethUtil = require('ethereumjs-util')
const ethAbi = require('ethereumjs-abi')
const multihashes = require('multihashes')
const ethWallet = require('eth-lightwallet')
const Web3 = require('web3')
const web3 = new Web3()
const fs = require('fs')
const path = require('path')

const setCbAddressTxEncode = function (address) {
  if (ethUtil.isValidAddress(address) === false) throw new Error('Address provided is not valid')
  address = ethUtil.addHexPrefix(address)
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('setCBaddress(address)', address).toString('hex'))
}

const addDSourceTxEncode = function (datasourceObj) {
  if (typeof datasourceObj !== 'object') throw new Error('Not a valid datasource object')
  if (typeof datasourceObj.name === 'undefined' || typeof datasourceObj.units === 'undefined') throw new Error('Missing params')
  var proofIncluded = typeof datasourceObj.proof !== 'undefined' ? datasourceObj.proof : '0x00'
  if (isNaN(parseInt(proofIncluded)) === false) proofIncluded = intToHex(proofIncluded)
  return '0xB5BFDD73' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['string', 'bytes1', 'uint256'], [datasourceObj.name, proofIncluded, datasourceObj.units]).toString('hex'))
}

const multiAddDSourceTxEncode = function (dsObjList) {
  if (typeof dsObjList !== 'object') throw new Error('Not a valid datasource object')
  var datasourceHash = []
  var datasourceUnit = []
  for (var i = 0; i < dsObjList.length; i++) {
    if (typeof dsObjList[i].name === 'undefined' || typeof dsObjList[i].units === 'undefined') throw new Error('Missing params')
    var proofIncluded = typeof dsObjList[i].proof !== 'undefined' ? dsObjList[i].proof : '0x00'
    if (isNaN(parseInt(proofIncluded)) === false) proofIncluded = intToHex(proofIncluded)
    var dsHash = sha3Sol([dsObjList[i].name, proofIncluded])
    datasourceHash.push(dsHash)
    datasourceUnit.push(dsObjList[i].units)
  }
  if (datasourceHash.length !== datasourceUnit.length) throw new Error('Array length not equal')
  return '0x6C0F7EE7' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['bytes32[]', 'uint256[]'], [datasourceHash, datasourceUnit]).toString('hex'))
}

const setBasePriceTxEncode = function (price) {
  if (typeof price < 0) throw new Error('Price should be above 0')
  price = web3.toWei(price, 'ether')
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('setBasePrice(uint256)', price).toString('hex'))
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

const changeOwnerTxEncode = function (owner) {
  if (typeof owner !== 'string') throw new Error('Expected a string')
  if (ethUtil.isValidAddress(owner) === false) throw new Error('Address provided is not valid')
  owner = ethUtil.addHexPrefix(owner)
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('changeOwner(address)', owner).toString('hex'))
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
  if (typeof result === 'object' && typeof result.value !== 'undefined') return Buffer.from(result.value, 'hex')
  else return result
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

const sha3Sol = function (args) {
  if (!(args instanceof Array)) throw new Error('args must be an a array')
  var hashArray = []
  for (var i = 0; i < args.length; i++) {
    var argConverted = ethUtil.isHexPrefixed(args[i]) ? args[i] : web3.toHex(args[i])
    hashArray.push(ethUtil.stripHexPrefix(argConverted))
  }
  var hashHex = hashArray.join('')
  return ethUtil.addHexPrefix(web3.sha3(hashHex, {encoding: 'hex'}))
}

const checkString = function (hex) {
  if (typeof hex !== 'string') throw new Error('hex must be string')
  return true
}

module.exports = {saveFile, saveJsonFile, getEventsName, containsProof, privateToPublic, toInt, callbackTxEncode, setCbAddressTxEncode, setAddrTxEncode, intToHex, loadLocalFile, loadLocalJson, generateNewAddress, addDSourceTxEncode, setBasePriceTxEncode, multiAddDSourceTxEncode, changeOwnerTxEncode}
