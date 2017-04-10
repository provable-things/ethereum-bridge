#!/usr/bin/env node
var bridgeHttp = require('./lib/bridge-http')
var bridgeUtil = require('./lib/bridge-util')
var BRIDGE = require('./package.json')

var BRIDGE_VERSION = BRIDGE.version
var BRIDGE_NAME = BRIDGE.name

var bridgeObj = {'BRIDGE_NAME': BRIDGE_NAME, 'BRIDGE_VERSION': BRIDGE_VERSION}
bridgeHttp.getPlatformInfo(bridgeObj, function (error, body) {
  if (error) return process.exit(1)
  var outdatedCheck = bridgeUtil.checkIfOutdated(bridgeObj, body)
  if (outdatedCheck.outdated === true) {
    console.log(outdatedCheck.version)
    return process.exit(1)
  } else {
    process.exit(0)
  }
})
