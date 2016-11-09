#!/usr/bin/env python
import argparse
from web3 import Web3, RPCProvider
from eth_abi.abi import decode_abi
import sys
import requests
import json
from time import sleep
import re
import subprocess
import tempfile
import base58
import string, random
from ethereum import transactions
from ethereum import utils
import rlp
from rlp.utils import decode_hex, encode_hex, str_to_bytes

oraclizeC = ''
oraclizeOAR = ''
contract = {}
defaultnode = 'localhost:8545'
listenOnlyMode = False
fallbackMode = False
abiOraclize = {}
abi = {}
mainAccount = ''
privateKey = ''
addressNonce = 0
defaultGas = 3000000

parser = argparse.ArgumentParser()

parser.add_argument('--oar',action='store',dest='oraclizeOAR',help='OAR Oraclize (address)')
parser.add_argument('-H',action='store',dest='defaultnodeIPPORT',help='eth node IP:PORT (default: localhost:8545)')
parser.add_argument('-p',action='store',dest='defaultnodePORT',help='eth node localhost port (default 8545)')
parser.add_argument('-a',action='store',dest='mainAccount',help='unlocked address used to deploy Oraclize connector and OAR')
parser.add_argument('--key',action='store',dest='key',help='JSON key file path (default: current folder key.json)')
parser.add_argument('--gas',action='store',dest='gas',help='change gas amount limit used to deploy contracts(in wei) (default: '+str(defaultGas)+')')
parser.add_argument('--loadabi',action='store_true',dest='loadabi',help='Load default abi interface (under ethereum-bridge/contracts/abi)')
parser.add_argument('--broadcast',action='store_true',dest='broadcast',help='Enable offline tx signing')
parser.set_defaults(broadcast=False)
parser.set_defaults(loadabi=False)

ops = parser.parse_args()

class JsonRPCerror(Exception):
    pass

def normalize_version(v):
    parts = [int(x) for x in v.split(".")]
    while parts[-1] == 0:
        parts.pop()
    return parts

def mycmp(v1, v2):
    return cmp(normalize_version(v1), normalize_version(v2))

def fallbackContracts():
	global OARsource, OCsource, dataB, dataC, fallbackMode

	if(not ops.oraclizeOAR):
		fallbackMode = True
		print('Deploying contracts already pre-compiled (solc version not found/invalid)')
	OCsource = open('../contracts/binary/oraclizeConnector.binary','r').read()
	dataC = OCsource
	abiOraclize = open('../contracts/abi/oraclizeConnector.json','r').read()

	OARsource = open('../contracts/binary/addressResolver.binary','r').read()
	dataB = OARsource
	abi = open('../contracts/abi/addressResolver.json','r').read()

def jrpcReq(content,params=[]):
	params = json.dumps(params)
	node = 'http://'+defaultnode
	data = '{"jsonrpc":"2.0","method":"'+content+'","params":'+params+',"id":1}'
	try:
		r = requests.post(node, data=data, headers={"Content-Type":"application/json"})
	except requests.exceptions.ConnectionError as e:
		hostSplit = defaultnode.split(":")[0]
		portSplit = defaultnode.split(":")[1]
		gethString = '--rpc --rpccorsdomain="*" --rpcaddr="%s" --rpcport="%s"' % (hostSplit,portSplit)
		sys.exit('\nError: http://'+defaultnode+' ethereum node not found, are you sure is it running?\n if you are using:\n * geth, append: '+gethString+'\n * ethereumjs-testrpc, try: testrpc -H %s\ncheck also if your node or this machine is allowed to connect (firewall,port etc..)\n' % defaultnode)

	if(r.status_code!=200):
		raise JsonRPCerror('JSONRPC request error')
	parsedResponse = json.loads(r.text)
	if('error' in parsedResponse):
		raise JsonRPCerror(r.text)
	else:
		return parsedResponse['result']

def loadContracts():
	global OARsource, OCsource, dataB, dataC

	try:
		availableCompilers = jrpcReq("eth_getCompilers",[])
		if('Solidity' in availableCompilers or 'solidity' in availableCompilers):
			compiledTest = jrpcReq('eth_compileSolidity',["contract test{}"])
			if('test' in compiledTest):
				compiledTest = compiledTest['test']['info']
			else:
				compiledTest = compiledTest['info']
			compilerVersion = compiledTest['compilerVersion'][:5]
			if(mycmp("0.2.2",compilerVersion)<=0 and (mycmp("0.3.6",compilerVersion)==0 or mycmp("0.3.6",compilerVersion)==1)):
				OCsource = open('../contracts/ethereum-api/connectors/oraclizeConnector.sol','r').read()
				cbLine = re.findall('\+?(cbAddress = 0x.*)\;',OCsource)[0]
				OCsource = OCsource.replace(cbLine,'cbAddress = '+str(mainAccount))
				compiledOC = jrpcReq('eth_compileSolidity',[OCsource])
				if("Oraclize" in compiledOC):
					dataC = compiledOC['Oraclize']
				else:
					dataC = compiledOC
				compiledOC = dataC
				dataC = dataC['code']

				OARsource = open('../contracts/ethereum-api/connectors/addressResolver.sol','r').read()
				compiledOAR = jrpcReq('eth_compileSolidity',[OARsource])
				if("OraclizeAddrResolver" in compiledOAR):
					dataB = compiledOAR['Oraclize']
				else:
					dataB = compiledOAR

				if(not ops.loadabi):
					abiOraclize = compiledOC['info']['abiDefinition']
					abi = dataB['info']['abiDefinition']
				else:
					abiOraclize = open('../contracts/abi/oraclizeConnector.json','r').read()
					abi = open('../contracts/abi/addressResolver.json','r').read()
				
				dataB = dataB['code']
			else:
				fallbackContracts()
				return
		else:
			fallbackContracts()
	except(OSError, IOError) as e:
		sys.exit('Contracts file not found,\nDid your run git clone --recursive ?')
	except Exception:
		fallbackContracts()

if(ops.gas):
	if(int(ops.gas)<1970000):
		sys.exit('Gas amount lower than 1970000 is not allowed')
	elif(int(ops.gas)>4700000):
		sys.exit('Gas amount bigger than 4700000 is not allowed')
	else:
		defaultGas = int(ops.gas)

if(ops.defaultnodeIPPORT!='' and ops.defaultnodeIPPORT is not None):
	if(':' in ops.defaultnodeIPPORT):
		defaultnode = ops.defaultnodeIPPORT
	else:
		sys.exit('Wrong IP:PORT format')

if(ops.defaultnodePORT!='' and ops.defaultnodePORT is not None):
	if(len(ops.defaultnodePORT)>0):
		defaultnode = 'localhost:'+ops.defaultnodePORT
	else:
		sys.exit('Port not valid')

nodeSplit = defaultnode.split(':')
web3 = Web3(RPCProvider(host='http://'+nodeSplit[0],port=nodeSplit[1]))

if(not ops.broadcast and not ops.mainAccount):
	# no args, generate a new local address
	print('no option choosen, generating a new address...\n')
	keyPath = '../keys.json' if not ops.key else ops.key
	randString = ''.join(random.SystemRandom().choice(string.ascii_uppercase + string.digits + string.ascii_lowercase) for _ in range(180))
	privateKey = utils.sha3(randString)
	mainAccount =  '0x'+utils.decode_addr(utils.privtoaddr(privateKey)).replace('0x','')
	privateKey = encode_hex(privateKey)
	try:
		privateKeyToSave = json.dumps([privateKey])
		contentLength = 0
		with open(keyPath, 'r+') as file:
			content = file.read()
			file.seek(0)
			if(len(content) > 0):
				contentObj = json.loads(content)
				contentObj.append(privateKey)
				contentLength = len(contentObj)
				file.write(json.dumps(contentObj))
				file.truncate()
			print('Private key saved in '+keyPath+' file\n')
			print('Generated address: '+mainAccount+' - at position: '+str(contentLength-1))
			ops.broadcast = True;
	except IOError:
		with open(keyPath, 'w') as file:
			file.write(privateKeyToSave)
			print('Private key saved in '+keyPath+' file\n')
			print('Generated address: '+mainAccount+' - at position: 0')
			ops.broadcast = True;
	except Exception as e:
		sys.exit(e)
elif(ops.broadcast):
	print('Broadcast mode active, a json key file is needed with your private in this format: ["privateKeyHex"]')
	try:
		accountIndex = 0 if not ops.mainAccount else int(ops.mainAccount)
		keyPath = '../keys.json' if not ops.key else ops.key
		with open(keyPath, 'r') as data:
			privateKeyList = json.loads(data.read())
			privateKey = decode_hex(privateKeyList[accountIndex])
			mainAccount = '0x'+encode_hex(utils.privtoaddr(privateKey))
	    	addressNonce = int(jrpcReq("eth_getTransactionCount",[mainAccount,"latest"]),16)
	    	print('Loaded '+mainAccount+' - at position: '+str(accountIndex))
	except IOError as e:
		sys.exit("private key not found in "+keyPath+" make sure this is the right path")
	except Exception as e:
		sys.exit(e)

if(ops.mainAccount and not mainAccount):
	addressUser = ops.mainAccount
	if(web3.isAddress(addressUser)):
		print "Using %s to act as Oraclize, make sure it's unlocked and do not use the same address to deploy your contracts" % (addressUser)
		mainAccount = addressUser
		web3.eth.defaultAccount = mainAccount
	else:
		if(addressUser=="-1"):
			listenOnlyMode = True
			print "*** Listen only mode"
		else:
			addressUserInt = int(addressUser)
			if(addressUserInt>=0 and addressUserInt<1000):
				mainAccount = jrpcReq('eth_accounts')[addressUserInt]
				web3.eth.defaultAccount = mainAccount
				print "Using %s to act as Oraclize, make sure it's unlocked and do not use the same address to deploy your contracts" % (mainAccount)
			else:
				sys.exit("Error, address is not valid")

if(not listenOnlyMode):
	loadContracts()

print 'eth node: '+defaultnode

def abiEncode(myid,resultName,proofName='none'):
	p = subprocess.Popen('node encode.js %s %s %s' % (myid,resultName,proofName), stdout=subprocess.PIPE, shell=True)
	sleep(0.35)
	o = p.communicate()
	output = o[0]
	return str(output).replace("\n",'')

def createQuery(query, callback):
	r = requests.post('https://api.oraclize.it/v1/query/create', data=json.dumps(query), headers={"Content-Type":"application/json","X-User-Agent":"ethereum-bridge/0.1.0 (python)"})
	if(r.status_code!=200):
		print 'Query error'
		return
	callback(json.loads(r.text))

def checkQueryStatus(queryId, callback):
	r = requests.get('https://api.oraclize.it/v1/query/'+queryId+'/status', headers={"Content-Type":"application/json","X-User-Agent":"ethereum-bridge/0.1.0 (python)"})
	if(r.status_code!=200):
		print 'Query error'
		return
	callback(json.loads(r.text))

def queryComplete(gasLimit, myid, result, proof, contractAddr):
	global addressNonce
	initialmyid = myid
	initialresult = result
	if(not listenOnlyMode):
		if(proof is None):
			myid = myid.ljust(2*32*(1+(len(myid)/2)/32),"0")
			result = str(result).encode('hex')

			result = [int(i, 16) for i in re.findall("..", result)]

			resultName = tempfile.NamedTemporaryFile().name
			file = open(resultName,"w")
			file.write(json.dumps(result))
			file.close()
			output = abiEncode(myid,resultName)

			encodedAbi = '0x27dc297e'+output
			if(ops.mainAccount and not ops.broadcast):
				jrpcReq('eth_sendTransaction',[{"from":mainAccount,"gas":hex(gasLimit),"value":"0x00","data":encodedAbi,"to":'0x'+contractAddr}])
			else:
				encodedAbi = encodedAbi.replace('0x','')
				tx = encode_hex(rlp.encode(transactions.Transaction(addressNonce, int(jrpcReq('eth_gasPrice'),16), gasLimit, contractAddr, 0, decode_hex(encodedAbi)).sign(privateKey)))
				jrpcReq('eth_sendRawTransaction',[tx])
				addressNonce+=1
		else:
			initialproof = proof
			if(len(initialproof)==46):
				proof = base58.b58decode(proof).encode('hex')

				myid = myid.ljust(2*32*(1+(len(myid)/2)/32),"0")

				result = str(result).encode('hex')
				result = [int(i, 16) for i in re.findall("..", result)]

				resultName = tempfile.NamedTemporaryFile().name
				file = open(resultName,"w")
				file.write(json.dumps(result))
				file.close()

				proof = [int(i, 16) for i in re.findall("..", proof)]
			else:
				initialproof = decode_hex(proof)
			proofName = tempfile.NamedTemporaryFile().name
			file = open(proofName,"w")
			file.write(json.dumps(proof))
			file.close()

			output = abiEncode(myid,resultName,proofName)

			encodedAbi = '0x38bbfa50'+output

			if(ops.mainAccount and not ops.broadcast):
				jrpcReq('eth_sendTransaction',[{"from":mainAccount,"gas":hex(gasLimit),"value":"0x00","data":encodedAbi,"to":'0x'+contractAddr}])
			else:
				encodedAbi = encodedAbi.replace('0x','')
				tx = encode_hex(rlp.encode(transactions.Transaction(addressNonce, int(jrpcReq('eth_gasPrice'),16), gasLimit, contractAddr, 0, decode_hex(encodedAbi)).sign(privateKey)))
				jrpcReq('eth_sendRawTransaction',[tx])
				addressNonce+=1

		if(proof is not None):
			print('proof: '+initialproof)
	print('myid: '+initialmyid)
	print('result: '+initialresult)
	if(not listenOnlyMode):
		print('Contract 0x'+contractAddr+ ' __callback called')
	else:
		print('Contract __callback called not called, listen only mode')
	return

def handleLog(data):
	global myid, cAddr, ds, formula, time, gasLimit, proofType, myidInitial

	myid = ''
	myidInitial = str(data[1]).encode('hex')[:64]
	cAddr = data[0]
	ds = data[3]
	formula = data[4]
	time = int(data[2])

	proofType = ord(data[len(data)-1]) if type(data[len(data)-1]) != int else data[len(data)-1]
	query = {
		"when": time,
		"datasource": ds,
		"query": formula,
		"proof_type": proofType
    }
	if(type(data[5]) is not int):
		arg2formula = data[5]
		query['query'] = [formula,arg2formula]
		gasLimit = data[6]
	else:
		gasLimit = data[5]

	print query

	def queryStatus(data):
		print('Query Result: '+str(data))

		if(not data['result'].has_key('checks')):
			sleep(5)
			checkQueryStatus(myid,queryStatus)
			return

		last_check = data["result"]["checks"][len(data["result"]["checks"])-1]
		query_result = last_check["results"][len(last_check["results"])-1]
		dataRes = query_result
		dataProof = data["result"]["checks"][len(data["result"]["checks"])-1]['proofs'][0]
		querySuccess = last_check["success"]

		if(querySuccess):
			if(dataProof is None and proofType is not 0):
				dataProof = encode_hex('None')
			queryComplete(gasLimit, myidInitial,dataRes,dataProof,cAddr)
		else:
			sleep(5)
			checkQueryStatus(myid,queryStatus)
			return

	def queryCreated(data):
		global myid
		if(len(data)>0):
			print('Query: '+str(data))
			myid = data['result']['id']
	        print('New query created, id: '+str(myid))
	        print('Checking query status every 5 seconds..')
	        checkQueryStatus(myid,queryStatus)

	createQuery(query,queryCreated)

def runLog():
	global contract, oraclizeC

	if(sys.getsizeof(contract)!=1048 and sys.getsizeof(contract)>0):
		oraclizeC = jrpcReq('eth_call',[{"to":oraclizeOAR,"data":"0x38cc4831"}, "latest"]).replace('0x000000000000000000000000','0x')
		if(oraclizeC=='0x'):
			sys.exit("Oraclize Connector not found, make sure you entered the correct OAR")
	print('Listening @ '+oraclizeC+' (Oraclize connector)')

	k=0
	while True:
		# check for logs
		if(k==0):
			filterId = jrpcReq('eth_newFilter',[{"address":oraclizeC}])
		dataLog = jrpcReq('eth_getFilterChanges',[filterId])
		if(type(dataLog) is list):
			if(len(dataLog)==0):
				dataLog = None
		if dataLog is not None:
			dataLog = dataLog[0]['data']
			try:
				types = ['address','bytes32','uint256','string','string','uint256','bytes1']
				result = decode_abi(types, dataLog)
			except:
				types = ['address','bytes32','uint256','string','string','string','uint256','bytes1']
				result = decode_abi(types, dataLog)
			print str(result)
			handleLog(result)
		else:
			sleep(0.5)
		k += 1

def OARgenerate():
	global contract, oraclizeOAR, dataB, privateKey, addressNonce, defaultGas

	dataB = '0x'+dataB.replace('0x','')
	if(ops.mainAccount and not ops.broadcast):
		contractOARtx = jrpcReq('eth_sendTransaction',[{"from":mainAccount,"gas":"0x2dc6c0","value":"0x00","data":dataB}])
	else:
		dataB = dataB.replace('0x','')
		tx = encode_hex(rlp.encode(transactions.Transaction(addressNonce, int(jrpcReq('eth_gasPrice'),16), defaultGas, "", 0, decode_hex(dataB)).sign(privateKey)))
		contractOARtx = jrpcReq('eth_sendRawTransaction',[tx])
		addressNonce+=1

	sleep(0.5)
	contractOAR = jrpcReq('eth_getTransactionReceipt', [contractOARtx])
	while contractOAR is None:
		contractOAR = jrpcReq('eth_getTransactionReceipt', [contractOARtx])
		sleep(2.5)

	oraclizeOAR = str(contractOAR['contractAddress'])
	sign4byte = '0xd1d80fdf' #setAddr(address)
	fillZero = '00000000'
	signatureC = sign4byte+fillZero+fillZero+fillZero+(oraclizeC.replace('0x',''))
	if(ops.mainAccount and not ops.broadcast):
		jrpcReq('eth_sendTransaction',[{"from":mainAccount,"to":oraclizeOAR,"data":signatureC}])
	else:
		signatureC = signatureC.replace('0x','')
		tx = encode_hex(rlp.encode(transactions.Transaction(addressNonce, int(jrpcReq('eth_gasPrice'),16), defaultGas, oraclizeOAR, 0, decode_hex(signatureC)).sign(privateKey)))
		jrpcReq('eth_sendRawTransaction',[tx])
		addressNonce+=1
	print('Generated OAR Address: '+oraclizeOAR)
	print('Please add this line to your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+oraclizeOAR+');\n\n')
	sleep(0.1)
	runLog()

def generateOraclize():
	global oraclizeC, contract, dataC, privateKey, addressNonce, defaultGas

	dataC = "0x"+dataC.replace("0x","")
	#if(int(jrpcReq('eth_getBalance',[mainAccount,'latest']),16)==0):
	#	sys.exit('Account '+mainAccount+' should have enough balance to sustain tx gas cost')
	balance = int(jrpcReq("eth_getBalance",[mainAccount,"latest"]),16)
	if(balance<50000000000000000):
		print("\n"+mainAccount+" doesn't have enough funds to cover transaction costs, please send at least 0.05 ETH")
		while balance<50000000000000000:
			balance = int(jrpcReq("eth_getBalance",[mainAccount,"latest"]),16)
			if(balance>=50000000000000000):
				balanceEth = '%.4f' % (balance/1000000000000000000)
				addressNonce = int(jrpcReq("eth_getTransactionCount",[mainAccount,"latest"]),16)
				print('Deploying contracts, received %s ETH' % (str(balanceEth)))
			sleep(2.5)
	if(ops.mainAccount and not ops.broadcast):
		contracttx = jrpcReq('eth_sendTransaction',[{"from":mainAccount,"gas":"0x2dc6c0","value":"0x00","data":dataC}])
	else:
		dataC = dataC.replace('0x','')
		tx = encode_hex(rlp.encode(transactions.Transaction(addressNonce, int(jrpcReq('eth_gasPrice'),16), defaultGas, "", 0, decode_hex(dataC)).sign(privateKey)))
		contracttx = jrpcReq('eth_sendRawTransaction',[tx])
		addressNonce+=1

	sleep(0.5)
	contract = jrpcReq('eth_getTransactionReceipt', [contracttx])
	while contract is None:
		contract = jrpcReq('eth_getTransactionReceipt', [contracttx])
		sleep(2.5)

	oraclizeC = str(contract['contractAddress'])
	sign4byte = '0x9BB51487' #setCBaddress(address)
	fillZero = '00000000'
	setCBinputData = sign4byte+fillZero+fillZero+fillZero+(mainAccount.replace('0x',''))
	if(fallbackMode and not ops.broadcast):
		jrpcReq('eth_sendTransaction',[{"from":mainAccount,"to":oraclizeC,"data":setCBinputData}])
		addressNonce+=1
	elif(fallbackMode and ops.broadcast):
		setCBinputData = setCBinputData.replace('0x','')
		tx = encode_hex(rlp.encode(transactions.Transaction(addressNonce, int(jrpcReq('eth_gasPrice'),16), defaultGas, oraclizeC, 0, decode_hex(setCBinputData)).sign(privateKey)))
		contracttx = jrpcReq('eth_sendRawTransaction',[tx])
		addressNonce+=1
	OARgenerate()

if(ops.oraclizeOAR!='' and ops.oraclizeOAR is not None):
	if(web3.isAddress(ops.oraclizeOAR)):
		oraclizeOAR = ops.oraclizeOAR
		print('OAR Address: '+oraclizeOAR)
		print('Make sure you have this line in your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+oraclizeOAR+');\n\n')
		if(not listenOnlyMode):
			runLog()
	else:
		sys.exit('The address provided is not valid')
else:
	if(not listenOnlyMode):
		generateOraclize()

if(listenOnlyMode and ops.oraclizeOAR and ops.abipath):
	runLog()
else:
	sys.exit('Listen only mode require the oar and abi path')

