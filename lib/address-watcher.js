'use strict'

const oracleInstance = require('./bridge-core').OracleInstance
const singleton = require('pragma-singleton')

function AddressWatcher (config) {
  this.watchAddress = config.address
  this.balanceLimit = config.balance_limit
  this.watchCheckInterval = config.check_interval || 300000 // 5 minutes by default
  this.subLogger = config.logger
  this.balanceCheck = false
}

AddressWatcher.prototype.init = function () {
  if (this.balanceCheck !== false) return
  const self = this
  this.balanceCheck = setInterval(function () {
    var accBalance = oracleInstance().checkAccountBalance()
    if (accBalance < self.balanceLimit) {
      self.subLogger.warn('please refill the callback address', self.watchAddress, ' reached balance limit', self.balanceLimit / 1000000000000000000)
    }
  }, this.watchCheckInterval)
}

AddressWatcher.prototype.stop = function () {
  if (this.balanceCheck === false) return
  clearInterval(this.balanceCheck)
  this.balanceCheck = false
}

module.exports = singleton(AddressWatcher)
