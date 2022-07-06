import { Account, connect, ConnectConfig, Near } from 'near-api-js'
import * as os from 'os'
import path from 'path'
import BN from 'bn.js'
import { existsSync } from 'fs'
import { InMemoryKeyStore } from 'near-api-js/lib/key_stores'
import { getTransactionLastResult } from 'near-api-js/lib/providers'
import { Metapool } from '@metapool/liquid-staking-sdk'
import { ContractState } from '@metapool/liquid-staking-sdk/dist/src/metapool'
import { assert } from 'console'
import { getConfig, ntoy, ytonFull } from './utils'

const TEST_USER = "test-narwallets.testnet"

const ONE_NEAR = new BN("1"+"0".repeat(24))
const TEN24 = ONE_NEAR

let connection:Near
let account:Account
let metapool:Metapool
let state: ContractState

async function prepareGlobals(){

  const config = getConfig("testnet")
  const privKeyPath=path.join(os.homedir(),".near-credentials",config.networkId,TEST_USER+".json")
  console.log(privKeyPath)
  if (!existsSync(privKeyPath)){
    throw new Error(`File not found: ${privKeyPath}`)
  }
  
  connection = await connect( 
    {...config, 
      keyStore: InMemoryKeyStore,
      keyPath:privKeyPath,
    } as unknown as ConnectConfig
  )
  account = await connection.account(TEST_USER)

  metapool = new Metapool(account, config.contractName)

  state = await metapool.get_contract_state()
}

async function test(){
    await prepareGlobals()

    // -----------
    // -- STAKE --
    // -----------
    const preBalance = await metapool.ft_balance_of(TEST_USER)
    //console.log("preBalance",ytonFull(preBalance))

    const amountYoctos = new BN("1"+"0".repeat(24))
    //const rawResult = await metapool.stake(amountYoctos)
    // console.log(getTransactionLastResult(rawResult))
    await metapool.stake(amountYoctos)

    const postBalance = await metapool.ft_balance_of(TEST_USER)
    //console.log("postBalance",ytonFull(postBalance), ytonFull(state.st_near_price))
    const expectedNewStNearBalance = new BN(preBalance).add(amountYoctos.mul(TEN24).div(new BN(state.st_near_price)))
    //console.log("postBalance",ytonFull(postBalance),"expected",ytonFull(expected.toString()))
    assert(ytonFull(postBalance)===ytonFull(expectedNewStNearBalance.toString()))

    // --------------------
    // -- LIQUID UNSTAKE --
    // --------------------

    const preBalanceNear = (await account.getAccountBalance()).available
    //console.log("preBalance",ytonFull(preBalance))

    const amountYoctoStNear = new BN("1"+"0".repeat(24))

    const expectedNear = amountYoctoStNear.mul(new BN(state.st_near_price)).div(TEN24)

    const rawResult = await metapool.liquidUnstake(amountYoctoStNear, expectedNear.sub(ONE_NEAR.divn(10))) // 0.1 NEAR slippage allowed
    const result = getTransactionLastResult(rawResult)
    console.log(result)

    const postBalanceNear = (await account.getAccountBalance()).available
    const liquidUnstakeFee = expectedNear.muln(state.nslp_current_discount_basis_points).divn(10000)
    console.log("liquidUnstakeFee",ytonFull(liquidUnstakeFee.toString()))
    const nearBalDiff=new BN(postBalanceNear).sub(new BN(preBalanceNear))
    console.log("nearBalDiff",ytonFull(nearBalDiff.toString()))
    const expectedMinusFee = expectedNear.sub(liquidUnstakeFee)

    console.log("expectedMinusFee",ytonFull(expectedMinusFee.toString()))
    console.log("diff",ytonFull(expectedMinusFee.sub(nearBalDiff).toString()))
    
    assert(ytonFull(result.near)===ytonFull(expectedMinusFee.toString()))
    
    // difference is tx fee
    const txFee=expectedMinusFee.sub(nearBalDiff)
    // tx fee, should be less than 0.002 NEAR
    assert(Number(ytonFull(txFee.toString())) < Number(ntoy(0.002)))

}

test();
