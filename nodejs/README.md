###Clone
Clone the repo with `git clone --recursive`

(to download all the submodules)

###Install
```
npm install
```

###How to use
```
node plugin
```

**Follow the console message**

Add `OAR = OraclizeAddrResolverI(EnterYourOarCustomAddress);` to your contract constructor, example:

**Note:** You need to change `EnterYourOarCustomAddress` with the address that is generated when you run `node plugin`
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
  * to specify the OAR address use `node plugin --oar EnterYourOarCustomAddress`
  * change the default eth node with `node plugin -H IP:PORT`
  * change the default PORT on localhost with `node plugin -p PORT`



  
