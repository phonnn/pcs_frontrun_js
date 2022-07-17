import Web3 from 'web3';
import fs from 'fs';
import { addABI, decodeMethod } from 'abi-decoder';
import { rateChangeCalculate, revenueCalculate, frontValueCalculate } from './utils.js';


const ws = 'ws://85.10.206.146:8546';
const web3 = new Web3(ws);

const ROUTER_ADDRESS = '0x10ed43c718714eb63d5aa57b78b54704e256024e';
const ROUTER_ABI = JSON.parse(fs.readFileSync('./RouterABI.json'));
const FACTORY_ADDRESS = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73';
const FACTORY_ABI = JSON.parse(fs.readFileSync('./FactoryABI.json'));
const PAIR_ABI = JSON.parse(fs.readFileSync('./PairABI.json'));
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
var factory = new web3.eth.Contract(FACTORY_ABI, FACTORY_ADDRESS);


addABI(ROUTER_ABI);

web3.eth.subscribe('pendingTransactions', (error, txhash) => {
    if (!error) {
        web3.eth.getTransaction(txhash, async (error, tx) => {
            if (tx != null) {
                var startBlock = await web3.eth.getBlockNumber();
                if(tx.to != null && tx.to.toLowerCase() == ROUTER_ADDRESS && ['0xfb3bdb41', '0x7ff36ab5'].includes(tx.input.slice(0, 10))){
                    let decodedData = decodeMethod(tx.input);
                    var amountOut, exactIn;
                    if (decodedData.name == 'swapExactETHForTokens') {
                        amountOut = decodedData.params.find(obj => obj.name == 'amountOutMin');
                        exactIn = true
                    } else if (decodedData.name == 'swapETHForExactTokens') {
                        amountOut = decodedData.params.find(obj => obj.name == 'amountOut');
                        exactIn = false
                    }

                    try {
                        let path = decodedData.params.find(obj => obj.name == 'path');
                        let pairAddress = await factory.methods.getPair(path.value[0], path.value[path.value.length - 1]).call();
                        let pair = new web3.eth.Contract(PAIR_ABI, pairAddress);
                        
                        let reserves = await pair.methods.getReserves().call();
                        let token0 = await pair.methods.token0().call();
                        // console.log(reserves)
                        var revs0, revs1;
                        if(token0.toLowerCase() == WBNB_ADDRESS){
                            revs0 = reserves._reserve0;
                            revs1 = reserves._reserve1;
                        } else {
                            revs0 = reserves._reserve1;
                            revs1 = reserves._reserve0;
                        }
    
                        let rateChange = rateChangeCalculate(Number(revs0), Number(revs1), Number(tx.value), exactIn);
                        if(rateChange > 0.5){
                            let frontValue = frontValueCalculate(Number(revs0), Number(revs1), Number(tx.value), Number(amountOut.value), exactIn);
                            let profits = revenueCalculate(Number(revs0), Number(revs1), Number(tx.value), frontValue, exactIn);
                            var endBlock = await web3.eth.getBlockNumber();

                            if(profits/1e18 < 0.004 || startBlock != endBlock){
                                return
                            }
                            
                            //đặt lệnh mua bán ở đây
                            console.log('profits', profits/1e18);
                        }
                    } catch (error) {
                        console.log(error)
                    }
                }
            }
        })
    } else {
        console.log(error);
    }
})