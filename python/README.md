###Requirements
- Python 2.7 only
- Node & npm

####Note
(on Ubuntu)

run `sudo apt-get install build-essential git python-pip python-dev libffi-dev libssl-dev -y`

###Install

Tip: setup a virtualenv for a cleaner installation

```
pip install -r requirements.txt
```
```
npm install -g ethereumjs-abi
```

###How to use
```
python plugin.py -H localhost:8545 -a 0
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
    * `python plugin.py -a 0` : use account 0 on localhost:8545
    * `python plugin.py -a 0 --broadcast` : use account at index n. 0 in your keys.json file (broadcast mode)
  * `--oar` : to specify the OAR address already deployed i.e. `python plugin.py --oar EnterYourOarCustomAddress`
  * `-H` : change the default eth node (localhost:8545)
  * `-p` : change the default PORT (8545) on localhost
  * `--key` : change the default key path (../keys.json) i.e. `python plugin.py --key /home/user/keys.json` 
  * `--gas` : change the default gas limit (3000000) used to deploy contracts
