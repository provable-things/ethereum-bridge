'use-strict'

const singleton = require('pragma-singleton')
const queue = require('queue')
const q = queue({ autostart: true, concurrency: 1})

function BridgeTxManager () {}

BridgeTxManager.prototype.queue = q

module.exports = singleton(BridgeTxManager)
