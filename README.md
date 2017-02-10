## Description
This tool enables any non-public blockchain instance to interact with the Oraclize service.

_Please note that at this point this tool is still **experimental** and subject to change without notice._

###Requirements
- node version **>= 5.0.0 < 7.0.0** (& npm)

Suggested version: node 6.9.1

####Note
(on Ubuntu)

run `sudo apt-get install build-essential -y`

###Install
```
npm install
```


###How to use

You have 2 options:
 * [active mode](#active-mode) (deploy and query contracts using one account on your main node) [DEFAULT]
 * [broadcast mode](#broadcast-mode) (deploy and query contracts using a local account (the node will be used only to broadcast the txs))

After you have correctly deployed the address resolver and the connector on your blockchain you can load the previous instance using the `--oar` flag (with the latest oar address generated) or using `--instance latest`

see also [optional flags](#optional-flags)

####Active mode

```
node bridge -H localhost:8545 -a 1
```
(deploy contracts using the account 1 found on the localhost:8545 node)


####Broadcast mode

Generate a new local address:

```
node bridge -H localhost:8545 --broadcast --new
```
(generate a new address locally and deploy contracts (txs broadcasted to localhost:8545 node))

or if you already have one or more account in your keys.json file:

```
node bridge -H localhost:8545 --broadcast -a 0
```
(load the first account in your keys.json file (index n.0) and deploy contracts (txs broadcasted to localhost:8545 node))


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
  * `--broadcast --new` : generate a new local address (private key automatically saved in ./config/instance/keys.json), and deploy contracts using the new address
  * `--broadcast` : enable offline tx signing (your node will be used to broadcast the raw transaction) **the broadcast mode will load your local keys.json file**
  * `-a` : change the default account used to deploy and call the transactions (account index and hex address are allowed) i.e:
    * `-a 0` : use account 0 on localhost:8545
    * `-a 0x123456 --broadcast` : load and use account 0x123456 (public-key) in your keys.json file (broadcast mode)
    * `-a 0 --broadcast` : use account at index n. 0 in your keys.json file (broadcast mode)
  * `--instance` : load a previous configuration file (filename) you can also use 'latest' to load the latest confiuration file, i.e. `--instance oracle_instance_1483441110.json` or `--instance latest`
  * `--from` `--to` : load and process logs starting --from (fromBlock) and --to (toBlock)  ('latest' is not allowed)  i.e. `--from 27384 --to 27387`
  * `--oar` : to specify the OAR address already deployed i.e. `--oar 0xEnterYourOarCustomAddress`
  * `-H` : change the default node (localhost:8545)
  * `-p` : change the default PORT (8545) on localhost
  * `--url` : change the default node with an url (http://localhost:8545)
  * `--key` : change the default key path (./config/instance/keys.json) i.e. `--key /home/user/keys.json` 
  * `--gas` : change the default gas limit (3000000) used to deploy contracts
  * `--resume` : resume all skipped queries
  * `--skip` : skip all pending queries
  * `--dev` : skip contract myid check and pending queries (useful for local testing)
  * `--disable-price` : skip datasource pricing and base price connector update
  * `--update-ds` : update datasource pricing only (pricing (if found) will be loaded from your local instance file, otherwise will be fetched from the remote oraclize API)
  * `--update-price` : update base price only (base price (if found) will be loaded from your local instance file, otherwise will be fetched from the remote oraclize API)
  * `--remote-price` : force the remote pricing fetch
