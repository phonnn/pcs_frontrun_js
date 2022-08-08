import Web3 from 'web3';
import fs from 'fs';
import { addABI, decodeMethod } from 'abi-decoder';
import { rateChangeCalculate, revenueCalculate, frontValueCalculate, getAmountOut, findTokenInfo } from './utils.js';

const ws = 'ws://85.10.206.146:8546';
const web3 = new Web3(ws);

const ROUTER_ADDRESS = '0x10ed43c718714eb63d5aa57b78b54704e256024e';
const ROUTER_ABI = JSON.parse(fs.readFileSync('./RouterABI.json'));

const FACTORY_ADDRESS = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73';
const FACTORY_ABI = JSON.parse(fs.readFileSync('./FactoryABI.json'));

const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';

const PAIR_ABI = JSON.parse(fs.readFileSync('./PairABI.json'));

const factory = new web3.eth.Contract(FACTORY_ABI, FACTORY_ADDRESS);
const router = new web3.eth.Contract(ROUTER_ABI, ROUTER_ADDRESS);

const admin = web3.eth.accounts.wallet.add('0x2da6afd74db6887bcbf79735c0d77e20901f444607a9b51a6b58e315eb9a356c')

const frontLimit = 0.1e18;
const fee = 0.003e18
const slippage = 0.99; //1%
const whiteList = JSON.parse(fs.readFileSync('./_cachePair.json'));

addABI(ROUTER_ABI);

async function tokenApprove(tokenAddress, amountIn, from){
    const token = new web3.eth.Contract(PAIR_ABI, tokenAddress);
    await token.methods.approve(web3.utils.toChecksumAddress(ROUTER_ADDRESS), amountIn.toString()).send({
        from: web3.utils.toChecksumAddress(from),
        gas: '200000',
    });
}

async function buy(pancakeswap, payableAmount, amountOutMin, path, from, to, deadline, gasPrice) {
    try {
        const tx = await pancakeswap.methods.swapExactETHForTokens(
            amountOutMin.toLocaleString('fullwide', { useGrouping: false }),
            path,
            web3.utils.toChecksumAddress(to),
            deadline,
        ).send({
            from: web3.utils.toChecksumAddress(from),
            gasPrice: web3.utils.toWei(gasPrice.toString(), 'Gwei'),
            gas: '200000',
            value: payableAmount.toString(),
        });
        return tx
    } catch (error) {
        return {status: false}
    }
}

async function sell(pancakeswap, amountIn, amountOutMin, path, from, to, deadline_mins) {
    let deadline = Math.floor(Date.now() / 1000) + 60 * deadline_mins;
    try {
        const tx = await pancakeswap.methods.swapExactTokensForETH(
            amountIn.toLocaleString('fullwide', { useGrouping: false }),
            amountOutMin.toLocaleString('fullwide', { useGrouping: false }),
            path,
            web3.utils.toChecksumAddress(to),
            deadline,
        ).send({
            from: web3.utils.toChecksumAddress(from),
            gasPrice: web3.utils.toWei('5', 'Gwei'),
            gas: '200000',
        });
        return tx
    } catch (error) {
        console.log("sell error", error)
        return {status: false}
    }
}

var queue = []

  
web3.eth.subscribe('pendingTransactions', (error, txhash) => {
    if (!error) {
        web3.eth.getTransaction(txhash, async (error, tx) => {
            if (tx != null) {
                var startBlock = await web3.eth.getBlockNumber();
                if (tx.to != null && tx.to.toLowerCase() == ROUTER_ADDRESS && ['0xfb3bdb41', '0x7ff36ab5'].includes(tx.input.slice(0, 10))) {
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
                        let tokenAddress = path.value[path.value.length - 1];
                        let tokenInfo = findTokenInfo(whiteList, tokenAddress);
                        
                        if(tokenInfo == undefined){
                            return
                        }

                        if (tokenInfo[1] > 0 || tokenInfo[2] > 0 || tokenInfo[3] < 500) {
                            return
                        }

                        let pair = new web3.eth.Contract(PAIR_ABI, tokenInfo[0]);

                        let reserves = await pair.methods.getReserves().call();
                        let token0 = await pair.methods.token0().call();

                        var revs_eth, revs_token;
                        if (token0.toLowerCase() == WBNB_ADDRESS) {
                            revs_eth = reserves._reserve0;
                            revs_token = reserves._reserve1;
                        } else {
                            revs_eth = reserves._reserve1;
                            revs_token = reserves._reserve0;
                        }

                        let rateChange = rateChangeCalculate(Number(revs_eth), Number(revs_token), Number(tx.value), exactIn);
                        if (rateChange > 0.5) {
                            let expectEthIn = frontValueCalculate(Number(revs_eth), Number(revs_token), Number(tx.value), Number(amountOut.value), exactIn);
                            var ethIn = expectEthIn;
                            if (ethIn > frontLimit) {
                                ethIn = frontLimit;
                            }

                            // console.log(`Target detected: ${tx.hash} -- Slippage: ${1-()}`);
                            console.log(`Target detected: ${tx.hash} -- ${Number(tx.value)/1e18} BNB -> ${Number(amountOut.value)} TOKEN`);
                            console.log(`Calculate BNB in ${expectEthIn/1e18} -- Real BNB in ${ethIn/1e18} BNB`);
                            revenueCalculate(Number(revs_eth), Number(revs_token), Number(tx.value), Number(amountOut.value), expectEthIn, exactIn);

                            if(queue.length >= 1){
                                return
                            }

                            queue.push(tx.hash);

                            let ethOut = revenueCalculate(Number(revs_eth), Number(revs_token), Number(tx.value), Number(amountOut.value), ethIn, exactIn);
                            
                            //đặt lệnh mua bán ở đây
                            let gasPrice = Number(web3.utils.fromWei(tx.gasPrice, 'Gwei')) + 2;
                            let tokenOutMin = Math.floor(getAmountOut(ethIn, Number(revs_eth), Number(revs_token)));

                            var endBlock = await web3.eth.getBlockNumber();

                            if (ethOut * slippage - ethIn > fee && startBlock == endBlock) {

                                let deadline = decodedData.params.find(obj => obj.name == 'deadline');
                                deadline = Number(deadline.value) - 1;

                                let buyTx = await buy(router, ethIn, tokenOutMin, [WBNB_ADDRESS, tokenAddress], admin.address, admin.address, deadline, gasPrice);

                                if (buyTx.status) {
                                    console.log(`target tx: ${tx.hash} -- buyTx: ${buyTx.transactionHash} -- ethIn: ${ethIn / 1e18} -- tokenOutMin: ${tokenOutMin.toLocaleString('fullwide', { useGrouping: false })}\n`);

                                    await tokenApprove(tokenAddress, tokenOutMin, admin.address);
                                    console.log(`target tx: ${tx.hash} -- approve\n`);
                                    let sellTx = await sell(router, tokenOutMin, Math.floor(ethOut * slippage), [tokenAddress, WBNB_ADDRESS], admin.address, admin.address, 1);

                                    if (sellTx.status) {
                                        let realEthOut = Number(sellTx.logs[sellTx.logs.length - 1].data);
                                        console.log(`target tx: ${tx.hash} -- sellTx: ${sellTx.transactionHash} -- ethOut: ${realEthOut} -- profits: ${(realEthOut - ethIn - fee) / 1e18}\n`);
                                    } else {
                                        // emergency sell
                                        var attempt = 0;
                                        while (attempt < 3) {
                                            //slippage 20%
                                            let sellTx = await sell(router, tokenOutMin, Math.floor(ethOut * 0.8), [tokenAddress, WBNB_ADDRESS], admin.address, admin.address, 1);

                                            if (sellTx.status) {
                                                let realEthOut = Number(sellTx.logs[sellTx.logs.length - 1].data);
                                                console.log(`target tx: ${tx.hash} -- sellTx: ${sellTx.transactionHash} -- ethOut: ${realEthOut} -- profits: ${(realEthOut - ethIn - fee) / 1e18}\n`);
                                                break;
                                            } else {
                                                attempt += 1;
                                            }
                                        }
                                                                                    
                                        if (attempt >= 3) {
                                            console.log(`target tx: ${tx.hash} -- SELL ERROR -- profits: ${(-ethIn - fee) / 1e18}\n`);
                                        }
                                    }
                                }
                            }
                            queue.pop();
                        }
                    } catch (error) {
                        if(tx.hash == queue[0]){
                            queue.pop()
                        }
                        if(error.message != undefined){
                            console.log(error.message, '\n')
                        } else {
                            console.log(error, '\n')
                        }
                    }
                }
            }
        })
    }
});