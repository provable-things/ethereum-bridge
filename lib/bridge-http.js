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

const handleResponse = function (error, response, body, callback) {
  if (error || (response.statusCode !== 200 && response.statusCode !== 401)) {
    var objError = {}
    if (error) objError.error = error
    objError.fatal = false
    return callback(error, body)
  } else {
    if (response.statusCode === 200) {
      return callback(null, body)
    } else if (response.statusCode === 401) {
      return callback({'fatal': true}, body)
    }
  }
}

module.exports = {
  createQuery,
  queryStatus
}
