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

addr = ''
oraclizeC = ''
oraclizeOAR = ''
contract = {}
defaultnode = 'localhost:8545'

def loadContracts():
	global OARsource
	global OCsource
	global dataB
	global abi
	global dataC
	global abiOraclize
	try:
		OCsource = open('ethereum-api/connectors/oraclizeConnector.sol','r').read()
		cbLine = re.findall('\+?(cbAddress = 0x.*)\;',OCsource)[0]
		OCsource = OCsource.replace(cbLine,'cbAddress = '+str(fromx))
		dataC = jrpcReq('eth_compileSolidity',[OCsource])['Oraclize']
		abiOraclize = dataC['info']['abiDefinition']

		OARsource = open('ethereum-api/connectors/addressResolver.sol','r').read()
		dataB = jrpcReq('eth_compileSolidity',[OARsource])['OraclizeAddrResolver']
		abi = dataB['info']['abiDefinition']
	except(OSError, IOError) as e:
		sys.exit('Contracts file not found,\nDid your run git clone --recursive ?')


def jrpcReq(content,params=[]):
	params = json.dumps(params)
	node = 'http://'+defaultnode
	data = '{"jsonrpc":"2.0","method":"'+content+'","params":'+params+',"id":1}'
	r = requests.post(node, data=data)
	if(r.status_code!=200):
		print 'JSONRPC request error'
		return
	parsedResponse = json.loads(r.text)
	if('error' in parsedResponse):
		sys.exit('JSONRPC error')
	else:
		return parsedResponse['result']

parser = argparse.ArgumentParser()

parser.add_argument('--oar',action='store',dest='oraclizeOAR',help='OAR Oraclize (address)')
parser.add_argument('-H',action='store',dest='defaultnodeIPPORT',help='eth node IP:PORT (default: localhost:8545)')
parser.add_argument('-p',action='store',dest='defaultnodePORT',help='eth node localhost port (default 8545)')

results = parser.parse_args()

if(results.defaultnodeIPPORT!='' and results.defaultnodeIPPORT is not None):
	if(':' in results.defaultnodeIPPORT):
		defaultnode = results.defaultnodeIPPORT
	else:
		sys.exit('Wrong IP:PORT format')

if(results.defaultnodePORT!='' and results.defaultnodePORT is not None):
	if(len(results.defaultnodePORT)>0):
		defaultnode = 'localhost:'+results.defaultnodePORT
	else:
		sys.exit('Port not valid')

nodeSplit = defaultnode.split(':')
web3 = Web3(RPCProvider(host='http://'+nodeSplit[0],port=nodeSplit[1]))
fromx = jrpcReq('eth_accounts')[0]
web3.eth.defaultAccount = fromx
loadContracts()
print 'eth node: '+defaultnode

def abiEncode(myid,resultName,proofName='none'):
	p = subprocess.Popen('node encode.js %s %s %s' % (myid,resultName,proofName), stdout=subprocess.PIPE, shell=True)
	sleep(0.35)
	o = p.communicate()
	output = o[0]
	return str(output).replace("\n",'')

def createQuery(query, callback):
	r = requests.post('https://api.oraclize.it/api/v1/query/create', data=json.dumps(query))
	if(r.status_code!=200):
		print 'Query error'
		return
	callback(json.loads(r.text))

def checkQueryStatus(queryId, callback):
	r = requests.get('https://api.oraclize.it/api/v1/query/'+queryId+'/status')
	if(r.status_code!=200):
		print 'Query error'
		return
	callback(json.loads(r.text))

def queryComplete(gasLimit, myid, result, proof, contractAddr):
	initialmyid = myid
	initialresult = result
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
		jrpcReq('eth_sendTransaction',[{"from":fromx,"gas":hex(gasLimit),"value":"0x00","data":encodedAbi,"to":'0x'+contractAddr}])
	else:
		initialproof = proof
		proof = base58.b58decode(proof).encode('hex')

		myid = myid.ljust(2*32*(1+(len(myid)/2)/32),"0")

		result = str(result).encode('hex')
		result = [int(i, 16) for i in re.findall("..", result)]

		resultName = tempfile.NamedTemporaryFile().name
		file = open(resultName,"w")
		file.write(json.dumps(result))
		file.close()

		proof = [int(i, 16) for i in re.findall("..", proof)]

		proofName = tempfile.NamedTemporaryFile().name
		file = open(proofName,"w")
		file.write(json.dumps(proof))
		file.close()

		output = abiEncode(myid,resultName,proofName)

		encodedAbi = '0x38bbfa50'+output

		jrpcReq('eth_sendTransaction',[{"from":fromx,"gas":hex(gasLimit),"value":"0x00","data":encodedAbi,"to":'0x'+contractAddr}])
	if(proof is not None):
		print('proof: '+initialproof)
	print('myid: '+initialmyid)
	print('result: '+initialresult)
	print('Contract 0x'+contractAddr+ ' __callback called')
	return

def handleLog(data):
	global myid
	global cAddr
	global ds
	global formula
	global time
	global gasLimit
	global proofType
	global myidInitial
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
		query['query'] = [formula,json.loads(data[5])]
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

		if((dataProof is None and proofType is not 0)):
			sleep(5)
			checkQueryStatus(myid,queryStatus)
			return
		else:
			queryComplete(gasLimit, myidInitial,dataRes,dataProof,cAddr)

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
	global contract
	global oraclizeC

	if(sys.getsizeof(contract)!=520 and sys.getsizeof(contract)>0):
		oraclizeC = jrpcReq('eth_call',[{"from":fromx,"to":oraclizeOAR,"data":"0x38cc4831"}, "latest"]).replace('0x000000000000000000000000','0x')

	print('Listening @ '+oraclizeC)

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
		sleep(0.5)
		k += 1

def OARgenerate():
	global oraclizeOAR
	global contract
	global dataB
	dataB = dataB['code']
	contractOARtx = jrpcReq('eth_sendTransaction',[{"from":fromx,"gas":"0x2dc6c0","value":"0x00","data":"0x"+dataB.replace('0x','')}])
	sleep(0.5)
	contractOAR = jrpcReq('eth_getTransactionReceipt', [contractOARtx])
	while contractOAR is None:
		contractOAR = jrpcReq('eth_getTransactionReceipt', [contractOARtx])
		sleep(2.5)
	oraclizeOAR = str(contractOAR['contractAddress'])
	sign4byte = '0xd1d80fdf' #setAddr(address)
	fillZero = '00000000'
	signatureC = sign4byte+fillZero+fillZero+fillZero+(oraclizeC.replace('0x',''))
	jrpcReq('eth_sendTransaction',[{"from":fromx,"to":oraclizeOAR,"data":signatureC}])
	print('Generated OAR Address: '+oraclizeOAR)
	print('Please add this line to your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+oraclizeOAR+');\n\n')
	sleep(0.1)
	runLog()

def generateOraclize():
	global oraclizeC
	global contract
	global dataC
	dataC = dataC['code']
	contracttx = jrpcReq('eth_sendTransaction',[{"from":fromx,"gas":"0x2dc6c0","value":"0x00","data":"0x"+dataC.replace('0x','')}])
	sleep(0.5)
	contract = jrpcReq('eth_getTransactionReceipt', [contracttx])
	while contract is None:
		contract = jrpcReq('eth_getTransactionReceipt', [contracttx])
		sleep(2.5)
	oraclizeC = str(contract['contractAddress'])
	OARgenerate()

if(results.oraclizeOAR!='' and results.oraclizeOAR is not None):
	if(web3.isAddress(results.oraclizeOAR)):
		oraclizeOAR = results.oraclizeOAR
		print('OAR Address: '+oraclizeOAR);
		print('Make sure you have this line in your contract constructor:\n\n'+'OAR = OraclizeAddrResolverI('+oraclizeOAR+');\n\n');
		runLog()
	else:
		sys.exit('The address provided is not valid')
else:
	generateOraclize();
