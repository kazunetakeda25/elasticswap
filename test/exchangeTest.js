const { expect } = require("chai");
const { ethers, deployments } = require("hardhat");

describe("Exchange", () => {
  let exchange;
  let baseToken;
  let quoteToken;
  let accounts;
  let liquidityFee;
  let initialSupply;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    await deployments.fixture();
    const QuoteToken = await deployments.get("QuoteToken");
    quoteToken = new ethers.Contract(
      QuoteToken.address,
      QuoteToken.abi,
      accounts[0]
    );

    const BaseToken = await deployments.get("BaseToken");
    baseToken = new ethers.Contract(
      BaseToken.address,
      BaseToken.abi,
      accounts[0]
    );

    const Exchange = await deployments.get("EGT Exchange");
    exchange = new ethers.Contract(Exchange.address, Exchange.abi, accounts[0]);

    liquidityFee = (await exchange.liquidityFee()) / 10000;
    initialSupply = await baseToken.totalSupply();
  });

  it("Should deploy with correct name, symbol and addresses", async () => {
    expect(await exchange.name()).to.equal("EGT LP Token");
    expect(await exchange.symbol()).to.equal("EGTLPS");
    expect(await exchange.baseToken()).to.equal(baseToken.address);
    expect(await exchange.quoteToken()).to.equal(quoteToken.address);
  });

  it("Should allow for user to supply liquidity and immediately withdrawal equal amounts", async () => {
    const amountToAdd = 1000000;
    // create expiration 50 minutes from now.
    const expiration = Math.round(new Date().getTime() / 1000 + 60 * 50);

    // check original balances
    expect(await quoteToken.balanceOf(accounts[0].address)).to.equal(
      initialSupply
    );
    expect(await baseToken.balanceOf(accounts[0].address)).to.equal(
      initialSupply
    );

    // add approvals
    await baseToken.approve(exchange.address, amountToAdd);
    await quoteToken.approve(exchange.address, amountToAdd);

    await exchange.addLiquidity(
      amountToAdd,
      amountToAdd,
      1,
      1,
      accounts[0].address,
      expiration
    );

    // check token balances after (should be reduced)
    expect(await quoteToken.balanceOf(accounts[0].address)).to.equal(
      initialSupply - amountToAdd
    );
    expect(await baseToken.balanceOf(accounts[0].address)).to.equal(
      initialSupply - amountToAdd
    );
    expect(await exchange.balanceOf(accounts[0].address)).to.equal(amountToAdd);

    // add approval for the liquidity tokens we now have.
    const amountToRedeem = amountToAdd / 2;
    await exchange.approve(exchange.address, amountToRedeem);

    await exchange.removeLiquidity(
      amountToRedeem,
      amountToRedeem,
      amountToRedeem,
      accounts[0].address,
      expiration
    );

    // confirm expected balances after redemption
    expect(await quoteToken.balanceOf(accounts[0].address)).to.equal(
      initialSupply - amountToRedeem
    );
    expect(await baseToken.balanceOf(accounts[0].address)).to.equal(
      initialSupply - amountToRedeem
    );
    expect(await exchange.balanceOf(accounts[0].address)).to.equal(
      amountToRedeem
    );
  });

  it("Should allow for user to supply liquidity, a rebase to occur, and correct withdraw of re-based qty", async () => {
    const amountToAdd = 1000000;
    // create expiration 50 minutes from now.
    const expiration = Math.round(new Date().getTime() / 1000 + 60 * 50);
    const liquidityProvider = accounts[1];

    // send a second user (liquidity provider) quote and base tokens for easy accounting.
    await quoteToken.transfer(liquidityProvider.address, amountToAdd);
    await baseToken.transfer(liquidityProvider.address, amountToAdd);

    // check original balances
    expect(await quoteToken.balanceOf(liquidityProvider.address)).to.equal(
      amountToAdd
    );
    expect(await baseToken.balanceOf(liquidityProvider.address)).to.equal(
      amountToAdd
    );

    // add approvals
    await baseToken
      .connect(liquidityProvider)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider)
      .approve(exchange.address, amountToAdd);

    await exchange
      .connect(liquidityProvider)
      .addLiquidity(
        amountToAdd,
        amountToAdd,
        1,
        1,
        liquidityProvider.address,
        expiration
      );

    // check token balances after (should be reduced)
    expect(await quoteToken.balanceOf(liquidityProvider.address)).to.equal(0);
    expect(await baseToken.balanceOf(liquidityProvider.address)).to.equal(0);
    expect(await exchange.balanceOf(liquidityProvider.address)).to.equal(
      amountToAdd
    );

    // simulate a rebase by sending more tokens to our exchange contract.
    expect(await quoteToken.balanceOf(exchange.address)).to.equal(amountToAdd);
    const rebaseAmount = 1000;
    await quoteToken.transfer(exchange.address, rebaseAmount);
    // confirm the exchange now has the expected balance after rebase
    expect(await quoteToken.balanceOf(exchange.address)).to.equal(
      amountToAdd + rebaseAmount
    );

    // we should be able to now pull out more tokens than we originally put in due to the rebase
    const totalQuoteTokenQtyToWithdraw = amountToAdd + rebaseAmount;
    // add approval for the liquidity tokens.
    await exchange
      .connect(liquidityProvider)
      .approve(exchange.address, amountToAdd);

    await exchange
      .connect(liquidityProvider)
      .removeLiquidity(
        amountToAdd,
        totalQuoteTokenQtyToWithdraw,
        amountToAdd,
        liquidityProvider.address,
        expiration
      );

    // confirm expected balances after redemption
    expect(await quoteToken.balanceOf(liquidityProvider.address)).to.equal(
      totalQuoteTokenQtyToWithdraw
    );
    expect(await baseToken.balanceOf(liquidityProvider.address)).to.equal(
      amountToAdd
    );
    expect(await exchange.balanceOf(liquidityProvider.address)).to.equal(0);
  });

  it("Should price trades correctly before and after a rebase when trading the base token", async () => {
    const amountToAdd = 1000000;
    // create expiration 50 minutes from now.
    const expiration = Math.round(new Date().getTime() / 1000 + 60 * 50);
    const liquidityProvider = accounts[1];
    const trader = accounts[2];

    // send a second user (liquidity provider) quote and base tokens.
    await quoteToken.transfer(liquidityProvider.address, amountToAdd);
    await baseToken.transfer(liquidityProvider.address, amountToAdd);

    // add approvals
    await baseToken
      .connect(liquidityProvider)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider)
      .approve(exchange.address, amountToAdd);

    // create liquidity
    await exchange
      .connect(liquidityProvider)
      .addLiquidity(
        amountToAdd,
        amountToAdd,
        1,
        1,
        liquidityProvider.address,
        expiration
      );

    // send trader base tokens
    await baseToken.transfer(trader.address, amountToAdd);
    // add approvals for exchange to trade their base tokens
    await baseToken.connect(trader).approve(exchange.address, amountToAdd);
    // confirm no balance before trade.
    expect(await quoteToken.balanceOf(trader.address)).to.equal(0);
    expect(await baseToken.balanceOf(trader.address)).to.equal(amountToAdd);

    // trader executes the first trade, our pricing should be ~1:1 currently minus fees
    const swapAmount = 100000;
    const expectedFee = swapAmount * liquidityFee;

    const baseTokenReserveBalance = await baseToken.balanceOf(exchange.address);
    let pricingConstantK = await exchange.pricingConstantK();
    const quoteTokenQtyReserveBeforeTrade =
      pricingConstantK / baseTokenReserveBalance.toNumber();
    const quoteTokenQtyReserveAfterTrade =
      pricingConstantK /
      (baseTokenReserveBalance.toNumber() + swapAmount - expectedFee);
    const quoteTokenQtyExpected =
      quoteTokenQtyReserveBeforeTrade - quoteTokenQtyReserveAfterTrade;

    await exchange
      .connect(trader)
      .swapBaseTokenForQuoteToken(swapAmount, 1, expiration);

    // confirm trade occurred at expected
    expect(await quoteToken.balanceOf(trader.address)).to.equal(
      Math.round(quoteTokenQtyExpected)
    );
    expect(await baseToken.balanceOf(trader.address)).to.equal(
      amountToAdd - swapAmount
    );

    // simulate a 25% rebase by sending more tokens to our exchange contract.
    const rebaseAmount = amountToAdd * 0.25;
    await quoteToken.transfer(exchange.address, rebaseAmount);

    // we have now simulated a rebase in quote token, we can execute a second
    // trade and confirm the price is unchanged based on the rebase
    // to make accounting easier, we will clear all quote tokens out of our traders wallet now.
    await quoteToken
      .connect(trader)
      .transfer(
        accounts[0].address,
        await quoteToken.balanceOf(trader.address)
      );
    expect(await quoteToken.balanceOf(trader.address)).to.equal(0);

    const swapAmount2 = 200000;
    const expectedFee2 = swapAmount2 * liquidityFee;
    const baseTokenReserveBalance2 = await baseToken.balanceOf(
      exchange.address
    );
    pricingConstantK = await exchange.pricingConstantK();
    const quoteTokenQtyReserveBeforeTrade2 =
      pricingConstantK / baseTokenReserveBalance2.toNumber();
    const quoteTokenQtyReserveAfterTrade2 =
      pricingConstantK /
      (baseTokenReserveBalance2.toNumber() + swapAmount2 - expectedFee2);
    const quoteTokenQtyExpected2 =
      quoteTokenQtyReserveBeforeTrade2 - quoteTokenQtyReserveAfterTrade2;

    await exchange
      .connect(trader)
      .swapBaseTokenForQuoteToken(swapAmount2, 1, expiration);

    expect(await quoteToken.balanceOf(trader.address)).to.equal(
      Math.round(quoteTokenQtyExpected2)
    );
    expect(await baseToken.balanceOf(trader.address)).to.equal(
      amountToAdd - swapAmount - swapAmount2
    );
  });

  it("Should price trades correctly before and after a rebase when trading the quote token", async () => {
    const amountToAdd = 1000000;
    // create expiration 50 minutes from now.
    const expiration = Math.round(new Date().getTime() / 1000 + 60 * 50);
    const liquidityProvider = accounts[1];
    const trader = accounts[2];

    // send a second user (liquidity provider) quote and base tokens.
    await quoteToken.transfer(liquidityProvider.address, amountToAdd);
    await baseToken.transfer(liquidityProvider.address, amountToAdd);

    // add approvals
    await baseToken
      .connect(liquidityProvider)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider)
      .approve(exchange.address, amountToAdd);

    // create liquidity
    await exchange
      .connect(liquidityProvider)
      .addLiquidity(
        amountToAdd,
        amountToAdd,
        1,
        1,
        liquidityProvider.address,
        expiration
      );

    // send trader quote tokens
    await quoteToken.transfer(trader.address, amountToAdd);
    // add approvals for exchange to trade their base tokens
    await quoteToken.connect(trader).approve(exchange.address, amountToAdd);
    // confirm no balance before trade.
    expect(await baseToken.balanceOf(trader.address)).to.equal(0);
    expect(await quoteToken.balanceOf(trader.address)).to.equal(amountToAdd);

    // trader executes the first trade
    const quoteTokenQtyToTrade = 100000;
    const expectedFee = quoteTokenQtyToTrade * liquidityFee;

    const baseTokenReserveQtyBalance = await baseToken.balanceOf(
      exchange.address
    );
    let pricingConstantK = await exchange.pricingConstantK();
    const quoteTokenQtyReserveBeforeTrade =
      pricingConstantK / baseTokenReserveQtyBalance.toNumber();
    const quoteTokenQtyReserveAfterTrade =
      quoteTokenQtyReserveBeforeTrade + quoteTokenQtyToTrade - expectedFee;
    const baseTokenReserveQtyAfterTrade =
      pricingConstantK / quoteTokenQtyReserveAfterTrade;
    const baseTokenQtyExpected =
      baseTokenReserveQtyBalance - baseTokenReserveQtyAfterTrade;

    await exchange
      .connect(trader)
      .swapQuoteTokenForBaseToken(quoteTokenQtyToTrade, 1, expiration);

    // confirm trade occurred at expected
    expect(await baseToken.balanceOf(trader.address)).to.equal(
      Math.round(baseTokenQtyExpected)
    );
    expect(await quoteToken.balanceOf(trader.address)).to.equal(
      amountToAdd - quoteTokenQtyToTrade
    );

    // simulate a 25% rebase by sending more tokens to our exchange contract.
    const rebaseAmount = amountToAdd * 0.25;
    await quoteToken.transfer(exchange.address, rebaseAmount);

    // we have now simulated a rebase in quote token, we can execute a second
    // trade and confirm the price is unchanged based on the rebase
    // to make accounting easier, we will clear all base tokens out of our traders wallet now.
    await baseToken
      .connect(trader)
      .transfer(accounts[0].address, await baseToken.balanceOf(trader.address));
    expect(await baseToken.balanceOf(trader.address)).to.equal(0);

    const quoteTokenQtyToTrade2 = 200000;
    const expectedFee2 = quoteTokenQtyToTrade2 * liquidityFee;
    const baseTokenReserveQtyBalance2 = await baseToken.balanceOf(
      exchange.address
    );

    pricingConstantK = await exchange.pricingConstantK();
    const quoteTokenQtyReserveBeforeTrade2 =
      pricingConstantK / baseTokenReserveQtyBalance2.toNumber();
    const quoteTokenQtyReserveAfterTrade2 =
      quoteTokenQtyReserveBeforeTrade2 + quoteTokenQtyToTrade2 - expectedFee2;
    const baseTokenReserveQtyAfterTrade2 =
      pricingConstantK / quoteTokenQtyReserveAfterTrade2;
    const baseTokenQtyExpected2 =
      baseTokenReserveQtyBalance2 - baseTokenReserveQtyAfterTrade2;

    await exchange
      .connect(trader)
      .swapQuoteTokenForBaseToken(quoteTokenQtyToTrade2, 1, expiration);

    expect(await baseToken.balanceOf(trader.address)).to.equal(
      Math.round(baseTokenQtyExpected2)
    );
    expect(await quoteToken.balanceOf(trader.address)).to.equal(
      amountToAdd - quoteTokenQtyToTrade - quoteTokenQtyToTrade2
    );
  });

  it("Should return fees to correct liquidity provider", async () => {
    const amountToAdd = 1000000;
    // create expiration 50 minutes from now.
    const expiration = Math.round(new Date().getTime() / 1000 + 60 * 50);
    const liquidityProvider1 = accounts[1];
    const liquidityProvider2 = accounts[2];
    const trader = accounts[3];

    // send a liquidity providers quote and base tokens.
    await quoteToken.transfer(liquidityProvider1.address, amountToAdd);
    await baseToken.transfer(liquidityProvider1.address, amountToAdd);
    await quoteToken.transfer(liquidityProvider2.address, amountToAdd);
    await baseToken.transfer(liquidityProvider2.address, amountToAdd);

    // add approvals
    await baseToken
      .connect(liquidityProvider1)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider1)
      .approve(exchange.address, amountToAdd);
    await baseToken
      .connect(liquidityProvider2)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider2)
      .approve(exchange.address, amountToAdd);

    // create liquidity from LP 1
    await exchange
      .connect(liquidityProvider1)
      .addLiquidity(
        amountToAdd,
        amountToAdd,
        1,
        1,
        liquidityProvider1.address,
        expiration
      );

    // confirm that LP#1 has expected LP tokens
    expect(await exchange.balanceOf(liquidityProvider1.address)).to.equal(
      amountToAdd
    );

    // send trader base tokens
    await baseToken.transfer(trader.address, amountToAdd);
    // add approvals for exchange to trade their base tokens
    await baseToken.connect(trader).approve(exchange.address, amountToAdd);

    // trader executes a first trade
    const swapAmount = 100000;
    await exchange
      .connect(trader)
      .swapBaseTokenForQuoteToken(swapAmount, 1, expiration);

    // simulate a 25% rebase by sending more tokens to our exchange contract.
    const rebaseAmount = amountToAdd * 0.25;
    await quoteToken.transfer(exchange.address, rebaseAmount);

    // create a second trade.
    const swapAmount2 = 200000;
    await exchange
      .connect(trader)
      .swapBaseTokenForQuoteToken(swapAmount2, 1, expiration);

    // calculate current ratio for providing liquidity
    const quoteTokenReserveQty = await quoteToken.balanceOf(exchange.address);
    const baseTokenReserveQty = await baseToken.balanceOf(exchange.address);
    const ratio =
      quoteTokenReserveQty.toNumber() / baseTokenReserveQty.toNumber();

    const quoteTokenQtyToAdd = Math.round(amountToAdd * ratio);

    // we also should calculate the expected liquidityTokens LP#2 should receive for this liquidity.
    const expectedLiquidityTokenQty =
      (amountToAdd * (await exchange.totalSupply())) / baseTokenReserveQty;

    // have second liquidity provider add liquidity
    await exchange
      .connect(liquidityProvider2)
      .addLiquidity(
        quoteTokenQtyToAdd,
        amountToAdd,
        quoteTokenQtyToAdd - 1,
        1,
        liquidityProvider2.address,
        expiration
      );

    expect(await exchange.balanceOf(liquidityProvider2.address)).to.equal(
      Math.floor(expectedLiquidityTokenQty)
    );

    const quoteTokenAddedAmountFromliquidityProvider2 =
      (await quoteToken.balanceOf(exchange.address)) - quoteTokenReserveQty;
    const baseTokenAddedAmountFromliquidityProvider2 =
      (await baseToken.balanceOf(exchange.address)) - baseTokenReserveQty;

    // confirm the LP#1 has no quote or base tokens
    expect(await quoteToken.balanceOf(liquidityProvider1.address)).to.equal(0);
    expect(await baseToken.balanceOf(liquidityProvider1.address)).to.equal(0);

    // withdraw all liquidity from the first provider,
    // and check their fees are correctly accounted for
    await exchange
      .connect(liquidityProvider1)
      .removeLiquidity(
        await exchange.balanceOf(liquidityProvider1.address),
        1,
        1,
        liquidityProvider1.address,
        expiration
      );

    // check that LP#1 has no more LP token
    expect(await exchange.balanceOf(liquidityProvider1.address)).to.equal(0);

    // the only tokens remaining in the pool should be the ones LP#2 just put in.
    expect(await quoteToken.balanceOf(exchange.address)).to.equal(
      quoteTokenAddedAmountFromliquidityProvider2
    );
    expect(await baseToken.balanceOf(exchange.address)).to.equal(
      baseTokenAddedAmountFromliquidityProvider2
    );

    // LP #2 should now be able to remove all his tokens
    // in equal amounts to what he put in (no fees to him or trades occurred).
    await exchange
      .connect(liquidityProvider2)
      .removeLiquidity(
        await exchange.balanceOf(liquidityProvider2.address),
        quoteTokenAddedAmountFromliquidityProvider2,
        baseTokenAddedAmountFromliquidityProvider2,
        liquidityProvider2.address,
        expiration
      );

    // check that no more LP tokens are outstanding
    expect(await exchange.totalSupply()).to.equal(0);

    // check that LP#2 has all his tokens back
    expect(await quoteToken.balanceOf(liquidityProvider2.address)).to.equal(
      amountToAdd
    );
    expect(await baseToken.balanceOf(liquidityProvider2.address)).to.equal(
      amountToAdd
    );
  });

  it("Should not return fees to liquidity provider who didn't experience any trades", async () => {
    const amountToAdd = 1000000;
    // create expiration 50 minutes from now.
    const expiration = Math.round(new Date().getTime() / 1000 + 60 * 50);
    const liquidityProvider1 = accounts[1];
    const liquidityProvider2 = accounts[2];
    const trader = accounts[3];

    // send a liquidity providers quote and base tokens.
    await quoteToken.transfer(liquidityProvider1.address, amountToAdd);
    await baseToken.transfer(liquidityProvider1.address, amountToAdd);
    await quoteToken.transfer(liquidityProvider2.address, amountToAdd);
    await baseToken.transfer(liquidityProvider2.address, amountToAdd);

    // add approvals
    await baseToken
      .connect(liquidityProvider1)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider1)
      .approve(exchange.address, amountToAdd);
    await baseToken
      .connect(liquidityProvider2)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider2)
      .approve(exchange.address, amountToAdd);

    // create liquidity from LP 1
    await exchange
      .connect(liquidityProvider1)
      .addLiquidity(
        amountToAdd,
        amountToAdd,
        1,
        1,
        liquidityProvider1.address,
        expiration
      );

    // confirm that LP#1 has expected LP tokens
    expect(await exchange.balanceOf(liquidityProvider1.address)).to.equal(
      amountToAdd
    );

    // send trader base tokens
    await baseToken.transfer(trader.address, amountToAdd);
    // add approvals for exchange to trade their base tokens
    await baseToken.connect(trader).approve(exchange.address, amountToAdd);

    // trader executes a first trade
    const swapAmount = 100000;
    await exchange
      .connect(trader)
      .swapBaseTokenForQuoteToken(swapAmount, 1, expiration);

    // simulate a 25% rebase by sending more tokens to our exchange contract.
    const rebaseAmount = amountToAdd * 0.25;
    await quoteToken.transfer(exchange.address, rebaseAmount);

    // create a second trade.
    const swapAmount2 = 200000;
    await exchange
      .connect(trader)
      .swapBaseTokenForQuoteToken(swapAmount2, 1, expiration);

    // calculate current ratio for providing liquidity
    const quoteTokenReserveQty = await quoteToken.balanceOf(exchange.address);
    const baseTokenReserveQty = await baseToken.balanceOf(exchange.address);
    const ratio =
      quoteTokenReserveQty.toNumber() / baseTokenReserveQty.toNumber();

    const quoteTokenQtyToAdd = Math.round(amountToAdd * ratio);

    // we also should calculate the expected liquidityTokens LP#2 should receive for this liquidity.
    const expectedLiquidityTokenQty =
      (amountToAdd * (await exchange.totalSupply())) / baseTokenReserveQty;

    // have second liquidity provider add liquidity
    await exchange
      .connect(liquidityProvider2)
      .addLiquidity(
        quoteTokenQtyToAdd,
        amountToAdd,
        quoteTokenQtyToAdd - 1,
        1,
        liquidityProvider2.address,
        expiration
      );

    expect(await exchange.balanceOf(liquidityProvider2.address)).to.equal(
      Math.floor(expectedLiquidityTokenQty)
    );

    const quoteTokenAddedAmountFromliquidityProvider2 =
      (await quoteToken.balanceOf(exchange.address)) - quoteTokenReserveQty;
    const baseTokenAddedAmountFromliquidityProvider2 =
      (await baseToken.balanceOf(exchange.address)) - baseTokenReserveQty;

    // have second LP remove liquidity, they should get back the same mount, no fees back to them.
    await exchange
      .connect(liquidityProvider2)
      .removeLiquidity(
        await exchange.balanceOf(liquidityProvider2.address),
        quoteTokenAddedAmountFromliquidityProvider2 - 1,
        baseTokenAddedAmountFromliquidityProvider2,
        liquidityProvider2.address,
        expiration
      );

    // confirm LP #2 has no more LP tokens
    expect(await exchange.balanceOf(liquidityProvider2.address)).to.equal(0);

    // confirm LP #2 has the balances they started with (and nothing more)
    expect(await quoteToken.balanceOf(liquidityProvider2.address)).to.equal(
      amountToAdd - 1
    );
    expect(await baseToken.balanceOf(liquidityProvider2.address)).to.equal(
      amountToAdd
    );
  });

  it("Should return the correct amount of tokens and fees to each liquidity provider", async () => {
    const amountToAdd = 2000000;
    // create expiration 50 minutes from now.
    const expiration = Math.round(new Date().getTime() / 1000 + 60 * 50);
    const liquidityProvider1 = accounts[1];
    const liquidityProvider2 = accounts[2];
    const trader = accounts[3];

    // send liquidity providers quote and base tokens.
    await quoteToken.transfer(liquidityProvider1.address, amountToAdd);
    await baseToken.transfer(liquidityProvider1.address, amountToAdd);
    await quoteToken.transfer(liquidityProvider2.address, amountToAdd);
    await baseToken.transfer(liquidityProvider2.address, amountToAdd);

    // add approvals
    await baseToken
      .connect(liquidityProvider1)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider1)
      .approve(exchange.address, amountToAdd);
    await baseToken
      .connect(liquidityProvider2)
      .approve(exchange.address, amountToAdd);
    await quoteToken
      .connect(liquidityProvider2)
      .approve(exchange.address, amountToAdd);

    const baseTokenQtyAddedByLp1 = amountToAdd / 2;
    // create liquidity from LP 1
    await exchange
      .connect(liquidityProvider1)
      .addLiquidity(
        baseTokenQtyAddedByLp1,
        baseTokenQtyAddedByLp1,
        1,
        1,
        liquidityProvider1.address,
        expiration
      );

    // send trader base tokens
    await baseToken.transfer(trader.address, amountToAdd);
    // add approvals for exchange to trade their base tokens
    await baseToken.connect(trader).approve(exchange.address, amountToAdd);

    // trader executes a first trade
    const baseTokenSwapAmount = 100000;
    await exchange
      .connect(trader)
      .swapBaseTokenForQuoteToken(baseTokenSwapAmount, 1, expiration);

    // lp #2 now adds liquidity
    // calculate current ratio for providing liquidity.
    // we want equal liquidity to what is already there so check the base balance
    // for how many base tokens LP2 will need to add.
    const baseTokenQtyAddedByLp2 = await baseToken.balanceOf(exchange.address);
    const quoteTokenQty = await quoteToken.balanceOf(exchange.address);
    const baseTokenQty = await baseToken.balanceOf(exchange.address);
    const ratio = quoteTokenQty.toNumber() / baseTokenQty.toNumber();

    const quoteTokenQtyToAdd = Math.round(baseTokenQtyAddedByLp2 * ratio);

    // have second liquidity provider add liquidity
    await exchange
      .connect(liquidityProvider2)
      .addLiquidity(
        quoteTokenQtyToAdd,
        baseTokenQtyAddedByLp2,
        quoteTokenQtyToAdd - 1,
        baseTokenQtyAddedByLp2 - 1,
        liquidityProvider2.address,
        expiration
      );

    // ensure both LPs have the same number of LP tokens
    expect(await exchange.balanceOf(liquidityProvider1.address)).to.equal(
      await exchange.balanceOf(liquidityProvider2.address)
    );

    // execute a second trade.
    await exchange
      .connect(trader)
      .swapBaseTokenForQuoteToken(baseTokenSwapAmount, 1, expiration);

    // we now should be able to have both lp token holders remove their lp tokens and
    // ensure they received correct allocation of base tokens.
    // LP1 should receive all qty for trade #1 and half for trade #2
    // LP2 should receive qty for trade #2
    // for easy accounting we will clear out the balances of base token in the lp accounts.
    await baseToken
      .connect(liquidityProvider1)
      .transfer(
        baseToken.address,
        await baseToken.balanceOf(liquidityProvider1.address)
      );
    await baseToken
      .connect(liquidityProvider2)
      .transfer(
        baseToken.address,
        await baseToken.balanceOf(liquidityProvider2.address)
      );

    const lp1ExpectedBaseTokenBalance =
      baseTokenQtyAddedByLp1 +
      baseTokenSwapAmount +
      Math.floor(baseTokenSwapAmount / 2);
    const lp2ExpectedBaseTokenBalance =
      baseTokenQtyAddedByLp2.toNumber() + Math.floor(baseTokenSwapAmount / 2);

    await exchange
      .connect(liquidityProvider1)
      .removeLiquidity(
        await exchange.balanceOf(liquidityProvider1.address),
        1,
        1,
        liquidityProvider1.address,
        expiration
      );

    await exchange
      .connect(liquidityProvider2)
      .removeLiquidity(
        await exchange.balanceOf(liquidityProvider2.address),
        1,
        1,
        liquidityProvider2.address,
        expiration
      );

    expect(await baseToken.balanceOf(liquidityProvider1.address)).to.equal(
      lp1ExpectedBaseTokenBalance
    );
    expect(await baseToken.balanceOf(liquidityProvider2.address)).to.equal(
      lp2ExpectedBaseTokenBalance
    );
  });
});
