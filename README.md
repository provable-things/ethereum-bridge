## Description
This tool enables any non-public blockchain instance to interact with the Oraclize service.

_Please note that at this point this tool is still **experimental** and subject to change without notice._

###Requirements
- Node version >= 5.0.0 < 7.0.0 & npm

####Note
(on Ubuntu)

run `sudo apt-get install build-essential -y`

###Install
```
npm install
```

Suggested version: node 6.0.0 / npm 3.8.6

###How to use
```
node plugin -H localhost:8545 -a 0
```
(will start the ethereum-bridge on localhost:8545 and use account 0)

see also [optional flags](#optional-flags)

**Follow the console message**

Add `OAR = OraclizeAddrResolverI(EnterYourOarCustomAddress);` to your contract constructor, example:

**Note:** You need to change `EnterYourOarCustomAddress` with the address that is generated when you run the script
```
contract test() {
    ...
    
    function test() {
      // this is the constructor
      OAR = OraclizeAddrResolverI(0xf0f20d1a90c618163d762f9f09baa003a60adeff);
    }
  
    ...
}
```

**Note:** The address chosen will be used to deploy the Oraclize OAR and Connector, **make sure to not deploy contracts that use Oraclize on the same address.**

###Optional flags

* optional:
  * run the script without flags to generate a new local address (private key automatically saved in ethereum-bridge/keys.json)
  * `--broadcast` : enable offline tx signing (your eth node will be used to broadcast the raw transaction) **the broadcast mode will load your local keys.json file**
  * `-a` : change the default account used to deploy and call the transactions i.e:
    * `node plugin -a 0` : use account 0 on localhost:8545
    * `node plugin -a 0 --broadcast` : use account at index n. 0 in your keys.json file (broadcast mode)
  * `--oar` : to specify the OAR address already deployed i.e. `node plugin --oar EnterYourOarCustomAddress`
  * `-H` : change the default eth node (localhost:8545)
  * `-p` : change the default PORT (8545) on localhost
  * `--key` : change the default key path (../keys.json) i.e. `node plugin --key /home/user/keys.json` 
  * `--gas` : change the default gas limit (3000000) used to deploy contracts
  * `--resume` : resume all skipped queries
  * `--skip` : skip all pending queries
