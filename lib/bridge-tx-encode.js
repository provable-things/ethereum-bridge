'use strict'

const ethUtil = require('ethereumjs-util')
const ethAbi = require('ethereumjs-abi')
const bridgeUtil = require('./bridge-util')

const setCbAddressTxEncode = function (address) {
  address = ethUtil.addHexPrefix(address)
  if (ethUtil.isValidAddress(address) === false) throw new Error('Address provided is not valid')
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('setCBaddress(address)', address).toString('hex'))
}

// 'amount' for a future implementation
const withdrawFundsTxEncode = function (address, amount) {
  address = ethUtil.addHexPrefix(address)
  if (ethUtil.isValidAddress(address) === false) throw new Error('Address provided is not valid')
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('withdrawFunds(address)', address).toString('hex'))
}

const addDSourceTxEncode = function (datasourceObj) {
  if (typeof datasourceObj !== 'object') throw new Error('Not a valid datasource object')
  if (typeof datasourceObj.name === 'undefined' || typeof datasourceObj.units === 'undefined') throw new Error('Missing params')
  var proofIncluded = typeof datasourceObj.proof !== 'undefined' ? datasourceObj.proof : '0x00'
  if (isNaN(parseInt(proofIncluded)) === false) proofIncluded = bridgeUtil.intToHex(proofIncluded)
  return '0xB5BFDD73' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['string', 'bytes1', 'uint256'], [datasourceObj.name, proofIncluded, datasourceObj.units]).toString('hex'))
}

const multiAddDSourceTxEncode = function (dsObjList) {
  if (typeof dsObjList !== 'object') throw new Error('Not a valid datasource object')
  var datasourceHash = []
  var datasourceUnit = []
  for (var i = 0; i < dsObjList.length; i++) {
    if (typeof dsObjList[i].name === 'undefined' || typeof dsObjList[i].units === 'undefined') throw new Error('Missing params')
    var proofIncluded = typeof dsObjList[i].proof !== 'undefined' ? dsObjList[i].proof : '0x00'
    if (isNaN(parseInt(proofIncluded)) === false) proofIncluded = bridgeUtil.intToHex(proofIncluded)
    var dsHash = bridgeUtil.sha3Sol([dsObjList[i].name, proofIncluded])
    datasourceHash.push(dsHash)
    datasourceUnit.push(dsObjList[i].units)
  }
  if (datasourceHash.length !== datasourceUnit.length) throw new Error('Array length not equal')
  return '0x6C0F7EE7' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['bytes32[]', 'uint256[]'], [datasourceHash, datasourceUnit]).toString('hex'))
}

// price in ether
const setBasePriceTxEncode = function (price) {
  price = bridgeUtil.normalizePrice(price)
  price = bridgeUtil.web3.toWei(price, 'ether')
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('setBasePrice(uint256)', price).toString('hex'))
}

const setAddrTxEncode = function (address) {
  address = ethUtil.addHexPrefix(address)
  if (ethUtil.isValidAddress(address) === false) throw new Error('Address provided is not valid')
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('setAddr(address)', address).toString('hex'))
}

const changeOwnerTxEncode = function (owner) {
  if (typeof owner !== 'string') throw new Error('Expected a string')
  owner = ethUtil.addHexPrefix(owner)
  if (ethUtil.isValidAddress(owner) === false) throw new Error('Address provided is not valid')
  return ethUtil.addHexPrefix(ethAbi.simpleEncode('changeOwner(address)', owner).toString('hex'))
}

const callbackTxEncode = function (myid, result, proof, proofType) {
  myid = bridgeUtil.standardMyid(myid)
  result = bridgeUtil.standardResult(result)
  if (bridgeUtil.containsProof(proofType) === false) {
    // return ethUtil.addHexPrefix(ethAbi.simpleEncode("__callback(bytes32, string)", [myid, result]).toString('hex'))
    return '0x27DC297E' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['bytes32', 'string'], [myid, result]).toString('hex'))
  } else {
    proof = bridgeUtil.standardProof(proof)
    // return ethUtil.addHexPrefix(ethAbi.simpleEncode("__callback(bytes32, string, bytes", [myid, result, proof]).toString('hex'))
    return '0x38BBFA50' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['bytes32', 'string', 'bytes'], [myid, result, proof]).toString('hex'))
  }
}

const randDsUpdateHashTxEncode = function (hashList) {
  if (!(hashList instanceof Array)) throw new Error('Expected a an array')
  return '0x512C0B9C' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['bytes32[]'], [hashList]).toString('hex'))
}

const multisetProofTypeTxEncode = function (proofTypeList, addressList) {
  return '0xDB37E42F' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['uint256[]', 'address[]'], [proofTypeList, addressList]).toString('hex'))
}

const multisetCustomGasPriceTxEncode = function (gasPriceList, addressList) {
  return '0xD9597016' + ethUtil.stripHexPrefix(ethAbi.rawEncode(['uint256[]', 'address[]'], [gasPriceList, addressList]).toString('hex'))
}

module.exports = {
  callbackTxEncode,
  setCbAddressTxEncode,
  setAddrTxEncode,
  withdrawFundsTxEncode,
  addDSourceTxEncode,
  setBasePriceTxEncode,
  multiAddDSourceTxEncode,
  changeOwnerTxEncode,
  randDsUpdateHashTxEncode,
  multisetProofTypeTxEncode,
  multisetCustomGasPriceTxEncode
}
