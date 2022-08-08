function getAmountOut(amountIn, reserveIn, reserveOut) {
    let amountInWithFee = amountIn * 0.9975;
    let numerator = amountInWithFee * reserveOut;
    let denominator = reserveIn + amountInWithFee;
    return numerator / denominator
}

function getAmountIn(amountOut, reserveIn, reserveOut) {
    let numerator = reserveIn * amountOut
    let denominator = (reserveOut - amountOut) * 0.9975
    return numerator / denominator
}

function amountOutTraceback(resvETH, resvToken, expectedAmountOut, amountIn) {
    let a = - expectedAmountOut
    let b = 0.9975 * resvToken * amountIn * (1 - 0.9975) - expectedAmountOut * (2 * resvETH + amountIn)
    let c = resvETH * (0.9975 * amountIn * resvToken - expectedAmountOut * amountIn - expectedAmountOut * resvETH)

    return quadraticEquation(a, b, c)
}

function amountInTraceback(resvETH, resvToken, expectedAmountIn, amountOut) {
    let a = amountOut
    let b = 0.9975 * expectedAmountIn * resvToken * (0.9975 - 1) + amountOut * (0.9975 * expectedAmountIn + 2 * resvETH)
    let c = resvETH * (0.9975 * expectedAmountIn * amountOut + amountOut * resvETH - 0.9975 * expectedAmountIn * resvToken)

    return quadraticEquation(a, b, c)
}

function quadraticEquation(a, b, c) {
    let delta = b ** 2 - 4 * a * c

    if (delta < 0) {
        return 0
    } else if (delta == 0) {
        return -(b / (2 * a))
    } else {
        let x1 = (-(b) + Math.sqrt(delta)) / (2 * a)
        let x2 = (-(b) - Math.sqrt(delta)) / (2 * a)

        if (x1 < 0) {
            x1 = 0
        }

        if (x2 < 0) {
            x2 = 0
        }

        return x1 >= x2 ? x1 : x2
    }
}

function rateChangeCalculate(reserveIn, reserveOut, amount, exactIn = true) {
    // swapExactETHForTokens => exactIn = true
    // swapETHForExactTokens => exactIn = false

    let rate0 = reserveIn / reserveOut

    if (exactIn) {
        let amountOut = getAmountOut(amount, reserveIn, reserveOut)
        reserveIn += amount
        reserveOut -= amountOut
    } else {
        let amountIn = getAmountIn(amount, reserveIn, reserveOut)
        reserveIn += amountIn
        reserveOut -= amount
    }

    let rate1 = reserveIn / reserveOut
    return ((rate1 - rate0) / rate0) * 100
}

function frontValueCalculate(resvETH, resvToken, targetValue, amountOut, exactIn = true) {
    //  expected value if not front run
    var frontrunValue;
    if (exactIn) {
        var expectedAmountOut;
        if (amountOut == 0) {
            expectedAmountOut = 1
        } else {
            expectedAmountOut = amountOut
        }
        // console.log('expectedAmountOut',expectedAmountOut)
        frontrunValue = amountOutTraceback(resvETH, resvToken, expectedAmountOut, targetValue)
    } else {
        var expectedAmountIn;
        var minAmountIn = getAmountIn(resvETH, resvToken, amountOut)
        if (minAmountIn < targetValue) {
            expectedAmountIn = targetValue * 0.9
        } else {
            throw "EXCESSIVE_INPUT_AMOUNT"
        }
        frontrunValue = amountInTraceback(resvETH, resvToken, expectedAmountIn, amountOut)
    }

    if (frontrunValue >= targetValue || frontrunValue == 0) {
        frontrunValue = targetValue / 5;
    }

    return Math.floor(frontrunValue)
}

function revenueCalculate(resvETH, resvToken, targetIn, targetOut, frontValue, exactIn = true) {
    // exactIn = true => swapExactETHForTokens => targetValue = ETH amount
    // exactIn = false => swapETHForExactTokens => targetValue = Token amount
    // fornt run
    let frontRunAmountOut = getAmountOut(frontValue, resvETH, resvToken);
    resvETH += frontValue;
    resvToken -= frontRunAmountOut;
    console.log(`front run: ${frontValue/1e18} BNB -> ${frontRunAmountOut} TOKEN`);

    // target transactions
    if (exactIn) {
        let amountOut = getAmountOut(targetIn, resvETH, resvToken)
        resvETH += targetIn
        resvToken -= amountOut
        console.log(`target: ${targetIn/1e18} BNB -> ${amountOut} TOKEN`);
    } else {
        let amountIn = getAmountIn(targetOut, resvETH, resvToken)
        resvETH += amountIn
        resvToken -= targetOut
        console.log(`target: ${amountIn/1e18} BNB -> ${targetOut} TOKEN`);

    }

    // back run
    let backRunAmountOut = getAmountOut(frontRunAmountOut, resvToken, resvETH);
    console.log(`back run: ${frontRunAmountOut} TOKEN -> ${backRunAmountOut/1e18} BNB\n`);

    return backRunAmountOut
}

function findTokenInfo(tokenObj, tokenAddress) {
    let checksumAddress = Object.keys(tokenObj).find(token => token.toLowerCase() == tokenAddress.toLowerCase());
    return tokenObj[checksumAddress]
}

export { rateChangeCalculate, frontValueCalculate, revenueCalculate, getAmountOut, findTokenInfo }