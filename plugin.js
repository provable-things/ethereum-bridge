#!/usr/bin/env node
var Web3 = require('web3');
var stdio = require('stdio');
var request = require('request');
var fs = require('fs');
var path = require('path');
var ethTx = require('ethereumjs-tx');
var ethUtil = require('ethereumjs-util');
var ethAbi = require('ethereumjs-abi');
var bs58 = require('bs58');
var ethWallet = require('eth-lightwallet');
var readline = require('readline');
var i18n = require('i18n');
var loki = require('lokijs');
var versionCompare = require('compare-versions');
var db = new loki('./config/db.json',{
  autoload: true,
  autoloadCallback: loadHandler,
  autosave: true,
  autosaveInterval: 2000
});
var queriesDb;
var bridgeinfoDb;

function loadHandler(){
  // create a new collection if none was found
  if(db.collections.length==0 || db.getCollection('queries')==null && db.getCollection('bridgeinfo')==null){
    queriesDb = db.addCollection('queries');
    bridgeinfoDb = db.addCollection('bridgeinfo');
  } else {
    queriesDb = db.getCollection('queries');
    bridgeinfoDb = db.getCollection('bridgeinfo');
  }
  var storedVersion = bridgeinfoDb.get(1);
  if(storedVersion==null){
    bridgeinfoDb.insert({'name':BRIDGE_NAME,'version':BRIDGE_VERSION});
  }

  try {
    request.get('https://api.oraclize.it/v1/platform/info', {json: true, headers: { 'X-User-Agent': BRIDGE_NAME+'/'+BRIDGE_VERSION+' (nodejs)' }}, function (error, response, body) {
      if (error) console.error(error);
      if (response.statusCode == 200) {
        var latestVersion = body.result.distributions[BRIDGE_NAME].latest.version;
        if(versionCompare(BRIDGE_VERSION,latestVersion)==-1){
          console.error("YOU ARE NOT RUNNING THE LATEST "+BRIDGE_NAME.toUpperCase()+" VERSION, PLEASE UPGRADE TO "+latestVersion+" https://github.com/oraclize/"+BRIDGE_NAME);
        }
      } else console.error("UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST "+BRIDGE_NAME.toUpperCase());
    });
  } catch(e){
    console.error("ERROR, CANNOT FETCH THE LATEST VERSION, PLEASE MAKE SURE YOU ARE RUNNING THE LATEST VERSION");
  }

  var pendingQueries = queriesDb.find({
    '$or':[{
      'active':true
    },{
      'callback_complete':false
    }],
    '$and':[{
      'oar':oraclizeOAR
    },{
      'connector':oraclizeC
    },{
      'cbAddress':mainAccount
    }]
  });

  for(var i=0;i<pendingQueries.length;i++){
    queryDoc = pendingQueries[i];
    var timeDiff = parseInt(queryDoc.target_timestamp-(Date.now()/1000));
    var queryDelay = timeDiff<=0 ? 0 : timeDiff*1000;
    console.log("Checking query status in "+parseInt(queryDelay/1000)+" seconds");
    setTimeout(function() {
      checkQueryStatus(queryDoc,queryDoc.myid,queryDoc.myIdInitial,queryDoc.contractAddress,queryDoc.proofType,queryDoc.gasLimit);
    }, queryDelay);
  }
}

i18n.configure({
  defaultLocale: 'ethereum',
  updateFiles: false,
  objectNotation: true,
  directory: './config/text'
});

var BLOCKCHAIN_NAME = i18n.__("blockchain_name");
var BLOCKCHAIN_ABBRV = i18n.__("blockchain_abbrv");
var BLOCKCHAIN_BASE_UNIT = i18n.__("base_unit");
var BRIDGE_NAME = i18n.__("bridge_name");
var BRIDGE_VERSION = require('./package.json').version;

var oraclizeC = '',
    oraclizeOAR = '',
    contract,
    defaultnode = 'localhost:8545',
    url = '',
    listenOnlyMode = false,
    privateKey = '',
    addressNonce = '',
    myIdList = [],
    fallbackContractMode = false,
    generateAddress = false,
    mainAccount,
    defaultGas = 3000000;

var ops = stdio.getopt({
    'oar': {key: 'o', args: 1, description: 'OAR Oraclize (address)'},
    'url': {key: 'u', args: 1, description: BLOCKCHAIN_ABBRV+' node URL (default: http://'+defaultnode+')'},
    'HOST': {key: 'H', args: 1, description: BLOCKCHAIN_ABBRV+' node IP:PORT (default: '+defaultnode+')'},
    'port': {key: 'p', args: 1, description: BLOCKCHAIN_ABBRV+' node localhost port (default: 8545)'},
    'address': {key: 'a', args: 1, description: 'unlocked address used to deploy Oraclize connector and OAR'},
    'broadcast': {description: 'broadcast only mode, a json key file with the private key is mandatory to sign all transactions'},
    'gas': {args: 1, description: 'change gas amount limit used to deploy contracts(in wei) (default: '+defaultGas+')'},
    'key': {args: 1, description: 'JSON key file path (default: '+BRIDGE_NAME+'/keys.json)'},
    'nocomp': {description: 'disable contracts compilation'},
    'forcecomp': {description: 'force contracts compilation'},
    'loadabi': {description: 'Load default abi interface (under '+BRIDGE_NAME+'/contracts/abi)'}
});

if(ops.gas){
  if(ops.gas<1970000){
    throw new Error('Gas amount lower than 1970000 is not allowed');
  } else if(ops.gas>4700000){
    throw new Error('Gas amount bigger than 4700000 is not allowed');
  } else {
    defaultGas = ops.gas;
  }
}

if(ops.HOST){
  var hostIPPORT = (ops.HOST).trim();
  if(hostIPPORT.indexOf(':')===-1) {
    throw new Error('Error, port missing');
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

if(!ops.address && !ops.broadcast && ops.address!=-1){
  generateNewAddress();
}

function generateNewAddress(){
  generateAddress = true;
  console.log('no option choosen, generating a new address...\n');
    var password = ethWallet.keystore.generateRandomSeed();
    ethWallet.keystore.createVault({
      password: password,
    }, function (err, ks) {
      ks.keyFromPassword(password, function (err, pwDerivedKey) {
        if (err) throw err;
        ks.generateNewAddress(pwDerivedKey, 1);
        var addr = ks.getAddresses()[0];
        mainAccount = '0x'+addr.replace('0x','');
        var keyPath = (ops.key) ? ops.key : './keys.json';
        fs.readFile(keyPath, function read(err,data) {
          keysFile = data;
          if(err){
            if(err.code=='ENOENT') keysFile = '';
          }
          var privateKeyExported = ks.exportPrivateKey(addr,pwDerivedKey);
          privateKey = new Buffer(privateKeyExported,'hex');
          var privateToSave = [privateKeyExported];
          var accountPosition = 0;
          if(keysFile && keysFile.length>0){
            var privateToSave = privateKeyExported;
            var keyObj = JSON.parse(keysFile.toString());
            accountPosition = keyObj.length;
            keyObj.push(privateToSave);
            privateToSave = keyObj;
          }
          var contentToWrite = privateToSave;
          fs.writeFile(keyPath, JSON.stringify(contentToWrite), function (err) {
            if (err) return console.error(err);
            console.log('Private key saved in '+keyPath+' file\n');
            connectToWeb3();
            loadContracts();
            generateOraclize();
          });
          console.log('Generated address: '+addr+' - at position: '+accountPosition);
          ops.broadcast = true;
        });
      });
    });
}

// contracts var
var OCsource,
    dataC,
    abiOraclize,
    OARsource,
    dataB,
    abi;

function loadContracts(){
  try {
    var compilers = web3.eth.getCompilers();

    if(!compilers) {
      fallbackContracts();
      return;
    }
    if(compilers.indexOf('solidity')==-1 && compilers.indexOf('Solidity')==-1){
      fallbackContracts();
      return;
    }
    var solidityVersion = web3.eth.compile.solidity("contract test{}");
    solidityVersion = solidityVersion['test']['info']['compilerVersion'] || solidityVersion['info']['compilerVersion'];
    solidityVersion = solidityVersion.substr(0,5);
    if(versionCompare(solidityVersion,'0.2.2')==1 && (versionCompare(solidityVersion,'0.3.6')==-1 || versionCompare(solidityVersion,'0.3.6')==0)){
      // solidity version is >= 0.2.2 and < 0.3.6
      compileContracts();
    } else fallbackContracts();
  } catch (e){
    fallbackContracts();
  }
}

function fallbackContracts(){
  try {
    if(!ops.oar){
      console.log('Deploying contracts already pre-compiled (solc version not found/invalid)');
      fallbackContractMode = true;
    }
    OCsource = fs.readFileSync(path.join(__dirname, './contracts/binary/oraclizeConnector.binary')).toString();
    abiOraclize = JSON.parse(fs.readFileSync(path.resolve(__dirname, './contracts/abi/oraclizeConnector.json')).toString());
    dataC = OCsource;

    OARsource = fs.readFileSync(path.join(__dirname, './contracts/binary/addressResolver.binary')).toString();
    abi = JSON.parse(fs.readFileSync(path.join(__dirname, './contracts/abi/addressResolver.json')).toString());
    dataB = OARsource;
  } catch(e) {
      if(e.code==='ENOENT'){
        console.error('contract files not found');
        process.exit(1);
      } else {
        console.error(e);
        process.exit(1);
      }
  }
}

function compileContracts(){
  if(!fallbackContractMode){
    try {
      OCsource = fs.readFileSync(path.join(__dirname, './contracts/ethereum-api/connectors/oraclizeConnector.sol')).toString();
      var cbLine = OCsource.match(/\+?(cbAddress = 0x.*)\;/i)[0];
      OCsource = OCsource.replace(cbLine,'cbAddress = '+mainAccount+';');
      var compiledConnector = web3.eth.compile.solidity(OCsource);
      console.log(compiledConnector);
      dataC = compiledConnector['Oraclize'] || compiledConnector;
      var connectorObj = dataC;
      dataC = dataC['code'];

      OARsource = fs.readFileSync(path.join(__dirname, './contracts/ethereum-api/connectors/addressResolver.sol')).toString();
      var compiledOAR = web3.eth.compile.solidity(OARsource);
      dataB = compiledOAR['OraclizeAddrResolver'] || compiledOAR;
      var oarObj = dataB;
      dataB = dataB['code'];

      if(ops.loadabi){
        abiOraclize = JSON.parse(fs.readFileSync(path.resolve(__dirname, './contracts/abi/oraclizeConnector.json')).toString());
        abi = JSON.parse(fs.readFileSync(path.join(__dirname, './contracts/abi/addressResolver.json')).toString());
      } else {
        abiOraclize = connectorObj['info']['abiDefinition'];
        abi = oarObj['info']['abiDefinition'];
      }
    } catch(e){
      if(e.code==='ENOENT'){
        throw new Error('Contracts file not found,\nDid your run git clone --recursive ?');
      } else throw e;
    }
  }
}

var web3 = new Web3();
defaultnode = (url!='') ? url : 'http://'+defaultnode;

if(!generateAddress) connectToWeb3();

if(ops.address && !ops.broadcast){
  var addressUser = ops.address;
  if(web3.isAddress(addressUser)){
    console.log('Using '+addressUser+' to act as Oraclize, make sure it is unlocked and do not use the same address to deploy your contracts');
    mainAccount = addressUser;
    web3.eth.defaultAccount = mainAccount;
  } else {
    if(addressUser==-1){
        listenOnlyMode = true;
        console.log("*** Listen only mode");
    } else {
        if(addressUser>=0 && addressUser<1000){
          mainAccount = web3.eth.accounts[addressUser];
          web3.eth.defaultAccount = mainAccount;
          console.log('Using '+mainAccount+' to act as Oraclize, make sure it is unlocked and do not use the same address to deploy your contracts');
        } else {
          throw new Error('Error, address is not valid');
        }
    }
  }
} else if(ops.broadcast) {
  console.log('Broadcast mode active, a json file is needed with private keys in this format: ["privateKeyHex"]');
  try {
    var keyPath = (ops.key) ? ops.key:'./keys.json';
    var privateKeyObj = JSON.parse(fs.readFileSync(keyPath).toString());
    var accountIndex = (ops.address && ops.address>=0) ? ops.address : 0;
    privateKey = privateKeyObj[accountIndex].replace('0x','');
    privateKey = new Buffer(privateKey,'hex');
    var publicKey = ethUtil.addHexPrefix(ethUtil.privateToAddress(privateKey).toString('hex'));
    mainAccount = publicKey;
    web3.eth.defaultAccount = mainAccount;
    addressNonce = web3.eth.getTransactionCount(mainAccount);
    console.log('Loaded '+mainAccount+' - at position: '+accountIndex);
  } catch(e) {
      if(e.code==='ENOENT'){
        //throw new Error('private key not found in '+keyPath+' make sure this is the right path');
        console.log("private key not found in "+keyPath);
        generateNewAddress();
      } else throw new Error('Private key load error ',e);
  }
}

if(!generateAddress){
  if(ops.forcecomp){
    compileContracts();
  } else {
    if(ops.oar && ops.loadabi){
        abiOraclize = JSON.parse(fs.readFileSync(path.resolve(__dirname, './contracts/abi/oraclizeConnector.json')).toString());
        abi = JSON.parse(fs.readFileSync(path.join(__dirname, './contracts/abi/addressResolver.json')).toString());
    } else {
      if(!listenOnlyMode && !ops.nocomp){
        loadContracts();
      } else if(!listenOnlyMode && ops.nocomp) fallbackContracts();
    }
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
      throw new Error('The address provided is not valid');
    }
  }
} else {
  if(!listenOnlyMode && !generateAddress){
    generateOraclize();
  }
}

if(listenOnlyMode && ops.oar && ops.loadabi && !generateAddress){
  runLog();
} else {
    if(listenOnlyMode){
      throw new Error('Listen only mode require the oar and abi path');
    }
}

function connectToWeb3(){
  console.log(BLOCKCHAIN_ABBRV+' node: '+defaultnode);
  console.log('Please wait...\n');
  web3.setProvider(new web3.providers.HttpProvider(defaultnode));
  if(!web3.isConnected()){
    var nodeSplit = defaultnode.substring(defaultnode.indexOf('://')+3).split(':');
    var portSplit = nodeSplit[1] || '8545';
    var hostSplit = nodeSplit[0] || '127.0.0.1';
    if(hostSplit=='localhost') hostSplit = '127.0.0.1';
    var startString =  i18n.__("connection_failed_tip");
    startString = startString ? startString.replace(/@HOST/g,hostSplit).replace(/@PORT/g,portSplit).replace(/'/g,'"') : "";
    throw new Error(defaultnode+' '+BLOCKCHAIN_NAME+' node not found, are you sure is it running?\n '+startString);
  }
}

function generateOraclize(){
  var balance = web3.eth.getBalance(mainAccount).toNumber();
  if(balance<500000000000000000){
    console.log("\n"+mainAccount+" doesn't have enough funds to cover transaction costs, please send at least 0.50 "+BLOCKCHAIN_BASE_UNIT);
    if((web3.version.node).match(/TestRPC/)){
      // node is TestRPC
      var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question("Authorize Oraclize to move funds automatically from your node? [Y/n]: ",function(answ){
        answ = answ.toLowerCase();
        if(answ.match(/y/)){
          var userAccount = '';
          rl.question("Please choose the unlocked account index number in your node: ",function(answ){
            if(answ>=0){
              userAccount = web3.eth.accounts[answ];
              if(typeof(userAccount)=="undefined") throw new Error("Account at index number: "+answ+" not found");
              rl.question("send 0.50 "+BLOCKCHAIN_BASE_UNIT+" from account "+userAccount+" (index n.: "+answ+") to "+mainAccount+" ? [Y/n]: ",function(answ){
                answ = answ.toLowerCase();
                if(answ.match(/y/)){
                  web3.eth.sendTransaction({"from":userAccount,"to":mainAccount,"value":500000000000000000});
                } else console.log('No authorization given, waiting for funds...');
              });
            } else console.log('Negative account index not allowed');
          });
        } else console.log('No authorization given, waiting for funds...');
      });
    }
    function checkFunds(){
      balance = web3.eth.getBalance(mainAccount).toNumber();
      if(balance<500000000000000000){
        setTimeout(checkFunds,2500);
      } else {
        console.log('Deploying contracts, received '+(balance/1000000000000000000).toFixed(4)+' '+BLOCKCHAIN_BASE_UNIT);
        generateOraclize();
      }
    };
    checkFunds();
  } else {
    if(ops.address && !ops.broadcast){
      contract = web3.eth.contract(abiOraclize).new({},{from:mainAccount,data:ethUtil.addHexPrefix(dataC),gas:web3.toHex(defaultGas)}, function(e, contract){
        if(e) console.log(e);
        if (typeof contract.address != 'undefined') {
          oraclizeC = contract.address;
          if(fallbackContractMode){
            web3.eth.contract(abiOraclize).at(oraclizeC).setCBaddress(mainAccount,{from:mainAccount,gas:web3.toHex(defaultGas)});
          }
          OARgenerate();
        }
       });
    } else if(ops.broadcast){
      addressNonce = web3.eth.getTransactionCount(mainAccount);
      var rawTx = {
        nonce: web3.toHex(addressNonce),
        gasPrice: web3.toHex(web3.eth.gasPrice),
        gasLimit: web3.toHex(defaultGas),
        value: '0x00',
        data: ethUtil.addHexPrefix(dataC)
      };
      var tx = new ethTx(rawTx);
      tx.sign(privateKey);
      var serializedTx = tx.serialize();
      web3.eth.sendRawTransaction(ethUtil.addHexPrefix(serializedTx.toString('hex')), function(err, hash) {
        if(err) console.error(err);
        var txInterval = setInterval(function(){
          var contract = web3.eth.getTransactionReceipt(hash);
          if(contract!=null){
            if(typeof(contract.contractAddress)=='undefined') return;
            clearInterval(txInterval);
            oraclizeC = contract.contractAddress;
            addressNonce++;
            if(fallbackContractMode){
              var setCBaddressInputData = ethAbi.simpleEncode("setCBaddress(address)",mainAccount).toString('hex');
              var rawTx = {
                nonce: web3.toHex(addressNonce),
                gasPrice: web3.toHex(web3.eth.gasPrice),
                gasLimit: web3.toHex(defaultGas),
                to: oraclizeC,
                value: '0x00',
                data: ethUtil.addHexPrefix(setCBaddressInputData)
              };
              var tx = new ethTx(rawTx);
              tx.sign(privateKey);
              var serializedTx = tx.serialize();
              web3.eth.sendRawTransaction(ethUtil.addHexPrefix(serializedTx.toString('hex')));
              addressNonce++;
            }
            OARgenerate();
          }
        }, 3000);
      });
    }
  }
}

function OARgenerate(){
  if(ops.address && !ops.broadcast){
    var contractOAR = web3.eth.contract(abi).new({},{from:mainAccount,data:ethUtil.addHexPrefix(dataB),gas:web3.toHex(defaultGas)}, function(e, contract){
      if (typeof contract.address != 'undefined') {
        oraclizeOAR = contract.address;
        contract.setAddr(oraclizeC, {from:mainAccount,gas:web3.toHex(defaultGas)});
        console.log('Generated OAR Address: '+oraclizeOAR);
        console.log('Please add this line to your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+oraclizeOAR+');\n\n');
        setTimeout(function(){
          runLog();
        },3000);
      }
    });
  } else if(ops.broadcast){
    var rawTx = {
      nonce: web3.toHex(addressNonce),
      gasPrice: web3.toHex(web3.eth.gasPrice), 
      gasLimit: web3.toHex(defaultGas),
      value: '0x00', 
      data: '0x'+dataB.replace('0x','')
    };
    var tx = new ethTx(rawTx);
    tx.sign(privateKey);
    var serializedTx = tx.serialize();
    web3.eth.sendRawTransaction(ethUtil.addHexPrefix(serializedTx.toString('hex')), function(err, hash) {
      if(err) console.error(err);
      var txInterval = setInterval(function(){
        var contractOAR = web3.eth.getTransactionReceipt(hash);
        if(contractOAR!=null){
          if(typeof(contractOAR.contractAddress)=='undefined') return;
          clearInterval(txInterval);
          addressNonce++;
          oraclizeOAR = contractOAR.contractAddress;
          contractOAR = web3.eth.contract(abi).at(oraclizeOAR);
          var txInputData = '0xd1d80fdf000000000000000000000000'+oraclizeC.replace('0x',''); // setAddr(address)
          var rawTx2 = {
            to: oraclizeOAR,
            nonce: web3.toHex(addressNonce),
            gasPrice: web3.toHex(web3.eth.gasPrice),
            gasLimit: web3.toHex(defaultGas),
            value: '0x00',
            data: txInputData
          };
          var tx2 = new ethTx(rawTx2);
          tx2.sign(privateKey);
          var serializedTx = tx2.serialize();
          web3.eth.sendRawTransaction(ethUtil.addHexPrefix(serializedTx.toString('hex')), function(err, hash) {
            if(err) console.error(err);
            var txInterval = setInterval(function(){
              if(web3.eth.getTransactionReceipt(hash)==null) return;
              clearInterval(txInterval);
              console.log('Generated OAR Address: '+oraclizeOAR);
              console.log('Please add this line to your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+oraclizeOAR+');\n\n');
              addressNonce++;
              setTimeout(function(){
                runLog();
              },3000);
            }, 3000);
          });
        }
      }, 3000);
    });
  }
}

function createQuery(query, callback){
  request.post('https://api.oraclize.it/v1/query/create', {body: query, json: true, headers: { 'X-User-Agent': BRIDGE_NAME+'/'+BRIDGE_VERSION+' (nodejs)' }}, function (error, response, body) {
    if (error) console.error(error);
    if (response.statusCode == 200) {
      callback(body);
    } else console.error("UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST "+BRIDGE_NAME.toUpperCase());
  });
}

function queryStatus(query_id, callback){
  request.get('https://api.oraclize.it/v1/query/'+query_id+'/status', {json: true, headers: { 'X-User-Agent': BRIDGE_NAME+'/'+BRIDGE_VERSION+' (nodejs)' }}, function (error, response, body) {
    if (error) console.error(error);
    if (response.statusCode == 200) {
      callback(body);
    } else console.error("UNEXPECTED ANSWER FROM THE ORACLIZE ENGINE, PLEASE UPGRADE TO THE LATEST "+BRIDGE_NAME.toUpperCase());
  });
}


function runLog(){
  if(typeof(contract)=="undefined"){
    oraclizeC = web3.eth.contract(abi).at(oraclizeOAR).getAddress.call();
    if(oraclizeC=='0x'){
      throw new Error("Oraclize Connector not found, make sure you entered the correct OAR");
    }
    contract = web3.eth.contract(abiOraclize).at(oraclizeC);
    if(contract.cbAddress()!=mainAccount){
      throw new Error("The connector was deployed by another account,\n callback address of the deployed connector "+contract.cbAddress()+" doesn't match with your current account "+mainAccount);
    }
  }

  console.log('Listening @ '+oraclizeC+' (Oraclize Connector)\n');

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
    var counter = 0;
    data = data['args'];
    var myIdInitial = data['cid'];
    myIdList[myIdInitial] = false;
    if(queriesDb.find({'myIdInitial':myIdInitial}).length!=0) return;
    var myid = myIdInitial;
    var cAddr = data['sender'];
    var ds = data['datasource'];
    if(typeof(data['arg']) != 'undefined'){
      var formula = data['arg'];
    } else {
      var arg2formula = data['arg2'];
      var formula = [data['arg1'],arg2formula];
    }
    var time = data['timestamp'].toNumber();
    var gasLimit = data['gaslimit'].toNumber();
    var proofType = ethUtil.addHexPrefix(data['proofType']);
    var query = {
        when: time,
        datasource: ds,
        query: formula,
        proof_type: parseInt(proofType)
    };
    console.log(formula);
    console.log(JSON.stringify(query));
    if(!myIdList[myIdInitial] && counter>0 || myIdList[myIdInitial]) return;
    createQuery(query, function(data){
      counter++;
      console.log("Query : "+JSON.stringify(data)); 
      myid = data.result.id;
      console.log("New query created, id: "+myid);
      var unixTime = parseInt(Date.now()/1000);
      var queryCheckDelay = getQueryDelay(time,unixTime);
      var queryDoc = queriesDb.insert({'active':true,'callback_complete':false,'target_timestamp':unixTime+(queryCheckDelay/1000),'oar':oraclizeOAR,'connector':oraclizeC,'cbAddress':mainAccount,'myid':myid,'myIdInitial':myIdInitial,'delay':time,'query':formula,'datasource':ds,'contractAddress':cAddr,'proofType':proofType,'gasLimit':gasLimit});
      console.log("Checking query status in "+parseInt(queryCheckDelay/1000)+" seconds");
      setTimeout(function() {
        // check query status
        checkQueryStatus(queryDoc,myid,myIdInitial,cAddr,proofType,gasLimit);
      }, queryCheckDelay);
    });
  }

  console.log("(Ctrl+C to exit)\n");
}

function getQueryDelay(time,unixTime){
  var queryCheckDelay = (time<=5 && time>=0) ? 0 : time;
  if(time>unixTime){
    queryCheckDelay = parseInt(time-unixTime);
  }
  return queryCheckDelay*1000;
}

function checkQueryStatus(queryDoc,myid,myIdInitial,contractAddress,proofType,gasLimit){
  console.log("Checking query status every 5 seconds..");
  var interval = setInterval(function(){
    queryStatus(myid, function(data){ console.log("Query result: "+JSON.stringify(data));  
      if(data.result.checks==null) return; 
      var last_check = data.result.checks[data.result.checks.length-1];
      var query_result = last_check.results[last_check.results.length-1];
      var dataRes = query_result;
      var dataProof = data.result.checks[data.result.checks.length-1]['proofs'][0];
      if (!last_check.success) return;
      else clearInterval(interval);
      if(dataProof==null && proofType!='0x00'){
        dataProof = new Buffer('None');
      } else if(typeof dataProof == 'object' && proofType!='0x00'){
        if(typeof dataProof.type != 'undefined' && typeof dataProof.value != 'undefined'){
          dataProof = new Buffer(dataProof.value);
        }
      }
      queryDoc.active = false;
      queriesDb.update(queryDoc);
      queryComplete(queryDoc, gasLimit, myIdInitial, dataRes, dataProof, contractAddress);
    });
  }, 5*1000);
}

function queryComplete(queryDoc, gasLimit, myid, result, proof, contractAddr){
  if(myIdList[myid] || queriesDb.find({'myIdInitial':myid}).callback_complete==true) return;
  if(!listenOnlyMode){
    if(proof==null){
      if(ops.address && !ops.broadcast){
        var callbackDefinition = [{"constant":false,"inputs":[{"name":"myid","type":"bytes32"},{"name":"result","type":"string"}],"name":"__callback","outputs":[],"type":"function"},{"inputs":[],"type":"constructor"}];
        web3.eth.contract(callbackDefinition).at(contractAddr).__callback(myid,result,{from:mainAccount,gas:web3.toHex(gasLimit),value:"0x0"}, function(e, contract){
          if(e){
            console.log(e);
          }
          myIdList[myid] = true;
        });
      } else {
        var inputResult = ethAbi.rawEncode(["bytes32","string"],[myid,result]).toString('hex');
        var rawTx = {
          nonce: web3.toHex(addressNonce),
          gasPrice: web3.toHex(web3.eth.gasPrice), 
          gasLimit: web3.toHex(gasLimit),
          to: contractAddr, 
          value: '0x00', 
          data: '0x27DC297E'+inputResult
        };
        var tx = new ethTx(rawTx);
        tx.sign(privateKey);
        var serializedTx = tx.serialize();
        web3.eth.sendRawTransaction(ethUtil.addHexPrefix(serializedTx.toString('hex')));
        myIdList[myid] = true;
        addressNonce++;
      }
    } else {
      var inputProof = (proof.length==46) ? bs58.decode(proof) : proof;
      if(ops.address && !ops.broadcast){
        var callbackDefinition = [{"constant":false,"inputs":[{"name":"myid","type":"bytes32"},{"name":"result","type":"string"},{"name":"proof","type":"bytes"}],"name":"__callback","outputs":[],"type":"function"},{"inputs":[],"type":"constructor"}];
        web3.eth.contract(callbackDefinition).at(contractAddr).__callback(myid,result,inputProof,{from:mainAccount,gas:web3.toHex(gasLimit),value:"0x0"}, function(e, contract){
          if(e){
            console.log(e);
          }
          myIdList[myid] = true;
        });
      } else {
        var inputResultWithProof = ethAbi.rawEncode(["bytes32","string","bytes"],[myid,result,inputProof]).toString('hex');
        var rawTx = {
          nonce: web3.toHex(addressNonce),
          gasPrice: web3.toHex(web3.eth.gasPrice), 
          gasLimit: web3.toHex(gasLimit),
          to: contractAddr, 
          value: '0x00', 
          data: '0x38BBFA50'+inputResultWithProof
        };
        var tx = new ethTx(rawTx);
        tx.sign(privateKey);
        var serializedTx = tx.serialize();
        web3.eth.sendRawTransaction(ethUtil.addHexPrefix(serializedTx.toString('hex')));
        myIdList[myid] = true;
        addressNonce++;
      }
      console.log('proof: '+proof);
    }
  }
  queryDoc.callback_complete = true;
  queriesDb.update(queryDoc);
  console.log('myid: '+myid);
  console.log('result: '+result);
  (!listenOnlyMode) ? console.log('Contract '+contractAddr+ ' __callback called') : console.log('Contract __callback not called (listen only mode)');
}
