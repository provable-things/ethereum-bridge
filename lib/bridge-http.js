'use-strict'

const request = require('request')

const createQuery = function (query, bridgeVersion, callback) {
  request.post('https://api.oraclize.it/v1/query/create',
    {body: query, json: true, headers: { 'X-User-Agent': bridgeVersion }}, function (error, response, body) {
      return handleResponse(error, response, body, callback)
    })
}

const queryStatus = function (queryId, bridgeVersion, callback) {
  request.get('https://api.oraclize.it/v1/query/' + queryId + '/status',
    {json: true, headers: { 'X-User-Agent': bridgeVersion }}, function (error, response, body) {
      return handleResponse(error, response, body, callback)
    })
}

const getPlatformInfo = function (bridgeObj, callback) {
  request.get('https://api.oraclize.it/v1/platform/info',
    {json: true, headers: { 'X-User-Agent': bridgeObj.BRIDGE_NAME + '/' + bridgeObj.BRIDGE_VERSION + ' (nodejs)' }}, function (error, response, body) {
      if (error) return callback(error, null)
      if (response.statusCode !== 200) return callback(new Error(response.statusCode, 'HTTP status', null))
      return callback(null, body)
    })
}

const handleResponse = function (error, response, body, callback) {
  if (error || (response.statusCode !== 200 && response.statusCode !== 401)) {
    var objError = {}
    if (error) objError.error = error
    objError.fatal = false
    return callback(error, body)
  } else {
    if (response.statusCode === 200) {
      if (typeof body === 'object' && typeof body.success !== 'undefined' && body.success === false) return callback({'fatal': false}, null)
      return callback(null, body)
    } else if (response.statusCode === 401) {
      return callback({'fatal': true}, body)
    }
  }
}

module.exports = {
  createQuery,
  queryStatus,
  getPlatformInfo
}
