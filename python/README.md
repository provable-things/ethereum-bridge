###Clone
Clone the repo with `git clone --recursive`

(to download all the submodules)

###Install
```
pip install -r requirements.txt
```
```
npm install -g ethereumjs-abi
```

###How to use
```
python plugin.py
```

**Follow the console message**

Add `OAR = OraclizeAddrResolverI(EnterYourOarCustomAddress);` to your contract constructor, example:

**Note:** You need to change `EnterYourOarCustomAddress` with the address that is generated when you run `python plugin.py`
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


* optional:
  * to specify the OAR address use `python plugin.py --oar EnterYourOarCustomAddress`
  * change the default eth node with `python plugin.py -H IP:PORT`
  * change the default PORT on localhost with `python plugin.py -p PORT`



  
