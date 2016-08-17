var Web3 = require('web3')
var stdio = require('stdio');
var request = require('request');
var fs = require('fs');
var path = require('path');

var addr = '',
    oraclizeC = '',
    oraclizeOAR = '',
    contract,
    defaultnode = 'localhost:8545',
    url = '',
    listenOnlyMode = false;

var ops = stdio.getopt({
    'oar': {key: 'o', args: 1, description: 'OAR Oraclize (address)'},
    'url': {key: 'u', args: 1, description: 'eth node URL (default: http://localhost:8545)'},
    'HOST': {key: 'H', args: 1, description: 'eth node IP:PORT (default: localhost:8545)'},
    'port': {key: 'p', args: 1, description: 'eth node localhost port (default 8545)'},
    'address': {key: 'a', args: 1, description: 'unlocked address used to deploy Oraclize connector and OAR', mandatory:true},
    'abipath': {args: 2, description: 'Oraclize OAR abi and Oraclize Connector abi definition path'}
});

if(ops.HOST){
  var hostIPPORT = (ops.HOST).trim();
  if(hostIPPORT.indexOf(':')===-1) {
    console.error('Error, port missing');
    return false;
  } else {
    defaultnode = hostIPPORT;
  }
}

if(ops.port){
  var hostPort = (ops.port).trim();
  defaultnode = 'localhost:'+hostPort;
}

if(ops.url){
  url = ops.url;
}

// check contracts
var OCsource,
    dataC,
    abiOraclize,
    OARsource,
    dataB,
    abi;

function loadContracts(){
  try {
    OCsource = fs.readFileSync(path.resolve(__dirname, 'ethereum-api/connectors/oraclizeConnector.sol')).toString();
    var cbLine = OCsource.match(/\+?(cbAddress = 0x.*)\;/i)[0];
    OCsource = OCsource.replace(cbLine,'cbAddress = '+from+';');
    dataC = web3.eth.compile.solidity(OCsource)['Oraclize'];
    abiOraclize = dataC['info']['abiDefinition'];

    OARsource = fs.readFileSync(path.resolve(__dirname, 'ethereum-api/connectors/addressResolver.sol')).toString();
    dataB = web3.eth.compile.solidity(OARsource)['OraclizeAddrResolver'];
    abi = dataB['info']['abiDefinition'];
  } catch(e){
      if(e.code==='ENOENT'){
        console.error('Contracts file not found,\nDid your run git clone --recursive ?');
        return false;
      } else throw e;
    }
}
console.log('eth node: '+defaultnode);

var web3 = new Web3();
defaultnode = (url!='') ? url:'http://'+defaultnode;

web3.setProvider(new web3.providers.HttpProvider(defaultnode));

var from;
if(ops.address){
  var addressUser = ops.address;
  if(web3.isAddress(addressUser)){
    console.log('Using '+addressUser+' to act as Oraclize, make sure is it unlocked and do not use the same address to deploy your contracts');
    from = addressUser;
    web3.eth.defaultAccount = from;
  } else {
    if(addressUser==-1){
        listenOnlyMode = true;
        console.log("*** Listen only mode");
    } else {
        if(addressUser>0 && addressUser<1000){
          from = web3.eth.accounts[addressUser];
          web3.eth.defaultAccount = from;
          console.log('Using '+from+' to act as Oraclize, make sure is it unlocked and do not use the same address to deploy your contracts');
        } else {
          console.error('Error, address is not valid');
          return false;
        }
    }
  }
}

if(ops.abipath){
  var abiListPath = ops.abipath;
  if(abiListPath.length==2){
    var abiDefinition1 = JSON.parse(fs.readFileSync(path.resolve(abiListPath[0])).toString());
    var abiDefinition2 = JSON.parse(fs.readFileSync(path.resolve(abiListPath[1])).toString());
    if(abiDefinition1.length<abiDefinition2.length){
      abi = abiDefinition1;
      abiOraclize = abiDefinition2;
    } else {
      abiOraclize = abiDefinition1;
      abi = abiDefinition2;
    }
  } else {
      console.error('Error, required 2 path');
      return false;
  }
} else {
  if(!listenOnlyMode){
    loadContracts();
  }
}

if(ops.oar){
  var addressOAR = (ops.oar).trim();
  if(addressOAR.length>=1){
    if(web3.isAddress(addressOAR)){
      // is valid
      oraclizeOAR = addressOAR;
      console.log('OAR Address: '+oraclizeOAR);
      console.log('Make sure you have this line in your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+oraclizeOAR+');\n\n');
      if(!listenOnlyMode) runLog();
    } else {
      console.error('The address provided is not valid');
      return false;
    }
  }
} else {
  if(!listenOnlyMode){
    generateOraclize();
  }
}

if(listenOnlyMode && ops.oar && ops.abipath){
  runLog();
} else {
    if(listenOnlyMode){
      console.error('Listen only mode require the oar and abi path');
      return false;
    }
}

function generateOraclize(){
  if(web3.eth.getBalance(from)==0){
      console.error('Account 1 should have enough balance to sustain tx gas cost');
      return false;
  }
  dataC = dataC['code'];
  contract = web3.eth.contract(abiOraclize).new({from:from,data:dataC,gas:3000000}, function(e, contract){
    if (typeof contract.address != 'undefined') {
      oraclizeC = contract.address;
      OARgenerate();
      }
   });
}


function OARgenerate(){
  dataB = dataB['code'];
  var contractOAR = web3.eth.contract(abi).new({from:from,data:dataB,gas:3000000}, function(e, contract){
    if (typeof contract.address != 'undefined') {
      oraclizeOAR = contract.address;
      contract.setAddr(oraclizeC, {from:from,gas:3000000});
      addr = contract.getAddress.call();
      console.log('Generated OAR Address: '+oraclizeOAR);
      console.log('Please add this line to your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+oraclizeOAR+');\n\n');
      setTimeout(function(){
        runLog();
      },100);
    }
  });
}

function createQuery(query, callback){
  request.post('https://api.oraclize.it/api/v1/query/create', {body: query, json: true}, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      callback(body);
    }
  });
}

function checkQueryStatus(query_id, callback){
  request.get('https://api.oraclize.it/api/v1/query/'+query_id+'/status', {json: true}, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      callback(body);
    }
  });
}


function runLog(){
  if(typeof(contract)=="undefined"){
    oraclizeC = web3.eth.contract(abi).at(oraclizeOAR).getAddress.call();
    contract = web3.eth.contract(abiOraclize).at(oraclizeC);
  }

  console.log('Listening @ '+oraclizeC);

  var log1e = contract.Log1([], [], function(err, data){
      if (err == null){
        handleLog(data);
      }
      });
    

  var log2e = contract.Log2([], [], function(err, data){
      if (err == null){
        handleLog(data);
      }
    });

  function handleLog(data){
    data = data['args'];

    var myid = myIdInitial = data['cid'];
    var cAddr = data['sender'];
    var ds = data['datasource'];
    if(typeof(data['arg']) != 'undefined'){
      var formula = data['arg'];
    } else {
      var formula = [data['arg1'],JSON.parse(data['arg2'])];
    }
    var time = parseInt(data['timestamp']);
    var gasLimit = data['gaslimit'];
    var proofType = data['proofType'];
    var query = {
        when: time,
        datasource: ds,
        query: formula,
        proof_type: parseInt(proofType)
    };
    console.log(formula);

      console.log(JSON.stringify(query)); 
      createQuery(query, function(data){
        console.log("Query : "+JSON.stringify(data)); 
        myid = data.result.id;
        console.log("New query created, id: "+myid);
        console.log("Checking query status every 5 seconds..");
        var interval = setInterval(function(){
          // check query status
          checkQueryStatus(myid, function(data){ console.log("Query result: "+JSON.stringify(data));  
            if(data.result.checks==null) return; 
            var last_check = data.result.checks[data.result.checks.length-1];
            var query_result = last_check.results[last_check.results.length-1];
            var dataRes = query_result;
            var dataProof = data.result.checks[data.result.checks.length-1]['proofs'][0];
            if (dataRes==null || (dataProof==null && proofType!='0x00')) return;
            else clearInterval(interval);
            queryComplete(gasLimit, myIdInitial, dataRes, dataProof, cAddr);
          });
                
        }, 5*1000);
      });
  }

}

function queryComplete(gasLimit, myid, result, proof, contractAddr){
  if(!listenOnlyMode){
    if(proof==null){
      var callbackDefinition = [{"constant":false,"inputs":[{"name":"myid","type":"bytes32"},{"name":"result","type":"string"}],"name":"__callback","outputs":[],"type":"function"},{"inputs":[],"type":"constructor"}];
      web3.eth.contract(callbackDefinition).at(contractAddr).__callback(myid,result,{from:from,gas:gasLimit,value:0}, function(e, contract){
        if(e){
          console.log(e);
        }
      });
    } else {
      var callbackDefinition = [{"constant":false,"inputs":[{"name":"myid","type":"bytes32"},{"name":"result","type":"string"},{"name":"proof","type":"bytes"}],"name":"__callback","outputs":[],"type":"function"},{"inputs":[],"type":"constructor"}];
      web3.eth.contract(callbackDefinition).at(contractAddr).__callback(myid,result,proof,{from:from,gas:gasLimit,value:0}, function(e, contract){
        if(e){
          console.log(e);
        }
      });
      console.log('proof: '+proof);
    }
  }
  console.log('myid: '+myid);
  console.log('result: '+result);
  (!listenOnlyMode) ? console.log('Contract '+contractAddr+ ' __callback called'):console.log('Contract __callback not called (listen only mode)');
}
