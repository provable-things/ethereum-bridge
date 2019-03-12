'use strict'

const ethUtil = require('ethereumjs-util')
const underscore = require('underscore')
const multihashes = require('multihashes')
const Web3 = require('web3')
const web3 = new Web3()
const fs = require('fs')
const path = require('path')
const colors = require('colors/safe')
const versionCompare = require('compare-versions')
const cryptoRandomString = require('crypto-random-string')
const crypto = require('crypto')

const checkIfOutdated = function (bridgeObj, platform) {
  var BRIDGE_NAME = bridgeObj.BRIDGE_NAME
  var BRIDGE_VERSION = bridgeObj.BRIDGE_VERSION
  var returnObj = {'outdated': true}
  try {
    if (typeof platform !== 'object' || !(BRIDGE_NAME in platform.result.distributions)) return false
    var latestVersion = platform.result.distributions[BRIDGE_NAME].latest.version
    if (versionCompare(BRIDGE_VERSION, latestVersion) === -1) {
      returnObj.version = latestVersion
      return returnObj
    } else {
      returnObj.outdated = false
      return returnObj
    }
  } catch (e) {
    return false
  }
}

const generateNewAddress = function (keyFile, callback) {
  let privBuffer = Buffer.from([])
  while (!ethUtil.isValidPrivate(privBuffer))
    privBuffer = crypto.randomBytes(32)
  
  const generatedAddress = ethUtil.addHexPrefix(ethUtil.privateToAddress(privBuffer).toString('hex'))
  let keyFileContent = ''
  fs.readFile(keyFile, function read (err, data) {
    if (err) {
      if (err.code === 'ENOENT') keyFileContent = ''
    }
    keyFileContent = data
    const privateKeyExported = privBuffer.toString('hex')
    let privateToSave = [privateKeyExported]
    let accountPosition = 0
    if (keyFileContent && keyFileContent.length > 0) {
      privateToSave = privateKeyExported
      const keyObj = JSON.parse(keyFileContent.toString())
      accountPosition = keyObj.length
      keyObj.push(privateToSave)
      privateToSave = keyObj
    }
    const contentToWrite = privateToSave
    fs.writeFile(keyFile, JSON.stringify(contentToWrite), function (err) {
      if (err) callback(new Error(err), null)
      callback(null, {'success': true, 'address': generatedAddress, 'account_position': accountPosition})
    })
  })
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
  if (typeof obj === 'object') obj = JSON.stringify(obj, null, 4)
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
  if (proof === null || proof === '') return Buffer.from('', 'hex')
  if (isValidMultihash(proof)) {
    return multihashToBytes(proof)
  } else {
    if (Buffer.isBuffer(proof)) return proof
    else return Buffer.from(proof, 'hex')
  }
}

const multihashToBytes = function (hash) {
  return new Uint8Array(multihashes.fromB58String(hash))
}

const isValidMultihash = function (hash) {
  try {
    return typeof multihashes.validate(multihashes.fromB58String(hash)) === 'undefined'
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
  const privateKeyBuff = Buffer.isBuffer(privateKey) === true ? privateKey : Buffer.from(privateKey, 'hex')
  return ethUtil.addHexPrefix(ethUtil.privateToAddress(privateKeyBuff).toString('hex'))
}

const toInt = function (hex) {
  checkString(hex)
  hex = ethUtil.addHexPrefix(hex)
  return parseInt(hex, 16)
}

const intToHex = function (number) {
  if (typeof number === 'string') number = parseInt(number)
  return ethUtil.addHexPrefix(ethUtil.intToHex(number))
}

const checkString = function (hex) {
  if (typeof hex !== 'string') throw new Error('hex must be string')
  return true
}

const getProof = function (proofContent, proofType) {
  if (!containsProof(proofType)) return null
  if (proofContent === null) {
    return Buffer.from('', 'hex')
  } else if (typeof proofContent === 'object') {
    if (typeof proofContent.type !== 'undefined' && typeof proofContent.value !== 'undefined') {
      return Buffer.from(proofContent.value, 'hex')
    }
  } else return proofContent
}

const checkErrors = function (data) {
  try {
    if (!('result' in data)) {
      return false
    } else if (getQueryError(data) !== null) return true
    else return false
  } catch (e) {
    return true
  }
}

const getQueryError = function (data) {
  try {
    if ('checks' in data.result) {
      if (data.result.checks.length === 0) return null
      var lastCheck = data.result.checks[data.result.checks.length - 1]
      if (typeof lastCheck['errors'][0] !== 'undefined') return lastCheck.errors
    } else {
      if (data.result['errors'].length > 0) return data.result.errors
    }
    return null
  } catch (e) {
    return null
  }
}

const getQueryUnixTime = function (time, unixTime) {
  if (time < unixTime && time > 1420000000) return 0
  if (time < 1420000000 && time > 5) return toPositiveNumber(unixTime + time)
  if (time > 1420000000) return toPositiveNumber(time)
  return 0
}

const isValidTime = function (time, now) {
  var queryTime = getQueryUnixTime(time)
  if (queryTime !== 0 && queryTime > now && (queryTime - now) >= 5184000) return false
  else return true
}

const toPositiveNumber = function (number) {
  if (number < 0) return 0
  else return parseInt(number)
}

const arrayCleanUp = function (array) {
  if (Object.keys(array).length > 15) {
    array.splice(0, array.length - 15)
    return array
  } else return array
}

const averageDelta = ([x, ...xs]) => {
  if (x === undefined) { return NaN } else {
    return xs.reduce(
      ([acc, last], x) => [acc + (x - last), x],
      [0, x]
    )[0] / xs.length
  }
}

const getLogLevels = function () {
  return {
    error: 0,
    warn: 1,
    info: 2,
    verbose: 3,
    debug: 4,
    stats: 5
  }
}

const parseLogLevel = function (level) {
  level = level.toLowerCase()
  if (Object.keys(getLogLevels()).indexOf(level) === -1) return 'info'
  return level
}

const getColorMap = function () {
  return {
    'info': 'cyan',
    'warn': 'yellow',
    'error': 'red',
    'verbose': 'magenta',
    'debug': 'bgYellow',
    'stats': 'bgBlue'
  }
}

const colorize = function (string) {
  var type = string.toLowerCase()
  if (typeof getColorMap()[type] !== 'undefined') {
    return colors[getColorMap()[type]](string)
  } else return string
}

const isSyncing = function (syncRes) {
  if (typeof syncRes === 'object' && syncRes.currentBlock >= syncRes.highestBlock) return false
  else return syncRes
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

const normalizePrice = function (price) {
  price = price < 0 || !isFinite(price) ? 0 : price
  return price
}

const createGroupedArray = function (arr, chunkSize) {
  var groups = [], i
  for (i = 0; i < arr.length; i += chunkSize) {
    groups.push(arr.slice(i, i + chunkSize))
  }
  return groups
}

const getContext = function (options) {
  var prefix = options.prefix || 'eth'
  var name = (options.random || !options.name) ? cryptoRandomString(10).toUpperCase() : options.name
  return prefix.toLowerCase() + '_' + name
}

const compareObject = function (obj1, obj2) {
  return underscore.isEqual(obj1, obj2)
}

module.exports = {
  saveFile,
  saveJsonFile,
  getEventsName,
  containsProof,
  privateToPublic,
  toInt,
  intToHex,
  loadLocalFile,
  loadLocalJson,
  generateNewAddress,
  getProof,
  checkErrors,
  getQueryError,
  getQueryUnixTime,
  toPositiveNumber,
  arrayCleanUp,
  isValidTime,
  averageDelta,
  getLogLevels,
  parseLogLevel,
  colorize,
  colors,
  checkIfOutdated,
  isSyncing,
  sha3Sol,
  standardResult,
  standardMyid,
  standardProof,
  normalizePrice,
  createGroupedArray,
  web3,
  getContext,
  compareObject
}
