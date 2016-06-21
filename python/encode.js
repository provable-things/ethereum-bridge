if (typeof String.prototype.startsWith != 'function') {
          //Implementation to startsWith starts below
          String.prototype.startsWith = function (str){
            return this.indexOf(str) == 0;
          };
        }

var abi = require('ethereumjs-abi');

fs = require('fs');

var myid = process.argv[2];
var resultTempName = process.argv[3];
var proofTempName = process.argv[4];

var result;
var proof;
if(proofTempName!='none'){
	fs.readFile(resultTempName, 'utf-8', function(err,data){
		if(err){
			return console.error(err)
		}
		result = JSON.parse(data);
	});
	fs.readFile(proofTempName, 'utf-8', function(err,data){
		if(err){
			return console.error(err)
		}
		proof = JSON.parse(data);
		encode(1);
	});
} else {
	fs.readFile(resultTempName, 'utf-8', function(err,data){
		if(err){
			return console.error(err)
		}
		result = JSON.parse(data);
		encode(0);
	});
}

function encode(type){
	if(type==1){
		var encoded = abi.rawEncode(['bytes32','bytes','bytes'], [myid, result, proof]);
	} else {
		var encoded = abi.rawEncode(['bytes32','bytes'], [myid, result]);
	}
	encoded = encoded.toString('hex');
	console.log(encoded);
	return encoded;
}
