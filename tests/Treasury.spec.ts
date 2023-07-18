import { compile } from '@ton-community/blueprint'
import { Blockchain, SandboxContract, TreasuryContract } from '@ton-community/sandbox'
import '@ton-community/test-utils'
import { Cell, Dictionary, beginCell, toNano } from 'ton-core'
import { between, bodyOp, createVset, emptyNewStakeMsg, setConfig } from './helper'
import { config, op } from '../wrappers/common'
import { Fees, Treasury, participationDictionaryValue, rewardDictionaryValue } from '../wrappers/Treasury'
import { Wallet } from '../wrappers/Wallet'

describe('Treasury', () => {
    let treasuryCode: Cell
    let walletCode: Cell
    let loanCode: Cell

    beforeAll(async () => {
        treasuryCode = await compile('Treasury')
        walletCode = await compile('Wallet')
        loanCode = await compile('Loan')
    })

    let blockchain: Blockchain
    let treasury: SandboxContract<Treasury>
    let driver: SandboxContract<TreasuryContract>
    let halter: SandboxContract<TreasuryContract>
    let governor: SandboxContract<TreasuryContract>
    let fees: Fees

    beforeEach(async () => {
        blockchain = await Blockchain.create()
        driver = await blockchain.treasury('driver')
        halter = await blockchain.treasury('halter')
        governor = await blockchain.treasury('governor')
        treasury = blockchain.openContract(Treasury.createFromConfig({
            totalCoins: 0n,
            totalTokens: 0n,
            totalStaking: 0n,
            totalUnstaking: 0n,
            totalValidatorsStake: 0n,
            participations: Dictionary.empty(Dictionary.Keys.BigUint(32), participationDictionaryValue),
            stopped: false,
            walletCode,
            loanCode,
            driver: driver.address,
            halter: halter.address,
            governor: governor.address,
            proposedGovernor: null,
            rewardShare: 4096n,
            rewardsHistory: Dictionary.empty(Dictionary.Keys.BigUint(32), rewardDictionaryValue),
            content: Cell.EMPTY,
        }, treasuryCode))

        const deployer = await blockchain.treasury('deployer')
        const deployResult = await treasury.sendDeploy(deployer.getSender(), '0.01')

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: treasury.address,
            value: toNano('0.01'),
            body: bodyOp(op.topUp),
            deploy: true,
            success: true,
            outMessagesCount: 0,
        })
        expect(deployResult.transactions).toHaveLength(2);

        fees = await treasury.getFees()

        await treasury.sendTopUp(deployer.getSender(), fees.treasuryStorage)
    })

    it('should deploy treasury', async () => {
    })

    it('should propose governor', async () => {
        const newGovernor = await blockchain.treasury('newGovernor')
        const result = await treasury.sendProposeGovernor(governor.getSender(), {
            value: '0.1',
            newGovernor: newGovernor.address
        })

        expect(result.transactions).toHaveTransaction({
            from: governor.address,
            to: treasury.address,
            value: toNano('0.1'),
            body: bodyOp(op.proposeGovernor),
            deploy: false,
            success: true,
            outMessagesCount: 1,
        })
        expect(result.transactions).toHaveTransaction({
            from: treasury.address,
            to: governor.address,
            value: between('0', '0.1'),
            body: bodyOp(op.gasExcess),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result.transactions).toHaveLength(3)

        const treasuryState = await treasury.getTreasuryState()
        const proposedGovernorCell = beginCell().storeAddress(newGovernor.address).endCell()
        expect((treasuryState.proposedGovernor || Cell.EMPTY).equals(proposedGovernorCell)).toBeTruthy()
        expect(treasuryState.governor.equals(governor.address)).toBeTruthy()
    })

    it('should accept governance', async () => {
        const newGovernor = await blockchain.treasury('newGovernor')
        await treasury.sendProposeGovernor(governor.getSender(), { value: '0.1', newGovernor: newGovernor.address })
        const result = await treasury.sendAcceptGovernance(newGovernor.getSender(), { value: '0.1' })

        expect(result.transactions).toHaveTransaction({
            from: newGovernor.address,
            to: treasury.address,
            value: toNano('0.1'),
            body: bodyOp(op.acceptGovernance),
            deploy: false,
            success: true,
            outMessagesCount: 1,
        })
        expect(result.transactions).toHaveTransaction({
            from: treasury.address,
            to: newGovernor.address,
            value: between('0', '0.1'),
            body: bodyOp(op.gasExcess),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result.transactions).toHaveLength(3)

        const treasuryState = await treasury.getTreasuryState()
        expect(treasuryState.governor.equals(newGovernor.address)).toBeTruthy()
        expect(treasuryState.proposedGovernor == null).toBeTruthy()
    })

    it('should set halter', async () => {
        const newHalter = await blockchain.treasury('newHalter')
        const result = await treasury.sendSetHalter(governor.getSender(), {
            value: '0.1',
            newHalter: newHalter.address
        })

        expect(result.transactions).toHaveTransaction({
            from: governor.address,
            to: treasury.address,
            value: toNano('0.1'),
            body: bodyOp(op.setHalter),
            deploy: false,
            success: true,
            outMessagesCount: 1,
        })
        expect(result.transactions).toHaveTransaction({
            from: treasury.address,
            to: governor.address,
            value: between('0', '0.1'),
            body: bodyOp(op.gasExcess),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result.transactions).toHaveLength(3)

        const treasuryState = await treasury.getTreasuryState()
        expect(treasuryState.halter.equals(newHalter.address)).toBeTruthy()
    })

    it('should set stopped', async () => {
        const result1 = await treasury.sendSetStopped(halter.getSender(), { value: '0.1', newStopped: true })

        expect(result1.transactions).toHaveTransaction({
            from: halter.address,
            to: treasury.address,
            value: toNano('0.1'),
            body: bodyOp(op.setStopped),
            deploy: false,
            success: true,
            outMessagesCount: 1,
        })
        expect(result1.transactions).toHaveTransaction({
            from: treasury.address,
            to: halter.address,
            value: between('0', '0.1'),
            body: bodyOp(op.gasExcess),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result1.transactions).toHaveLength(3)

        const treasuryState = await treasury.getTreasuryState()
        expect(treasuryState.stopped).toBeTruthy()

        const staker = await blockchain.treasury('staker')
        const result2 = await treasury.sendDepositCoins(staker.getSender(), { value: '10' })

        expect(result2.transactions).toHaveTransaction({
            from: staker.address,
            to: treasury.address,
            value: toNano('10'),
            body: bodyOp(op.depositCoins),
            deploy: false,
            success: false,
            outMessagesCount: 1,
        })
        expect(result2.transactions).toHaveTransaction({
            from: treasury.address,
            to: staker.address,
            value: between('9.9', '10'),
            body: bodyOp(0xffffffff),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result2.transactions).toHaveLength(3)

        const times = await treasury.getTimes()
        const electedFor = times.nextRoundSince - times.currentRoundSince
        const since = BigInt(Math.floor(Date.now() / 1000)) - electedFor / 2n
        const until = since + electedFor
        const vset = createVset(since, until)
        setConfig(blockchain, config.currentValidators, vset)

        const validator = await blockchain.treasury('validator')
        const result3 = await treasury.sendRequestLoan(validator.getSender(), {
            value: '152.7', // 101 (max punishment) + 50 (min payment) + 1.7 (fee)
            roundSince: until,
            loanAmount: '300000',
            minPayment: '50',
            validatorRewardShare: 102n, // 40%
            newStakeMsg: emptyNewStakeMsg,
        })

        expect(result3.transactions).toHaveTransaction({
            from: validator.address,
            to: treasury.address,
            value: toNano('152.7'),
            body: bodyOp(op.requestLoan),
            deploy: false,
            success: false,
            outMessagesCount: 1,
        })
        expect(result3.transactions).toHaveTransaction({
            from: treasury.address,
            to: validator.address,
            value: between('152.6', '152.7'),
            body: bodyOp(0xffffffff),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result3.transactions).toHaveLength(3)

        await treasury.sendSetStopped(halter.getSender(), { value: '0.1', newStopped: false })
        const walletAddress = await treasury.getWalletAddress(staker.address)
        const wallet = blockchain.openContract(Wallet.createFromAddress(walletAddress))
        const result4 = await treasury.sendDepositCoins(staker.getSender(), { value: '10' })

        expect(result4.transactions).toHaveTransaction({
            from: staker.address,
            to: treasury.address,
            value: toNano('10'),
            body: bodyOp(op.depositCoins),
            deploy: false,
            success: true,
            outMessagesCount: 1,
        })
        expect(result4.transactions).toHaveTransaction({
            from: treasury.address,
            to: wallet.address,
            value: between(fees.walletStorage, '0.1'),
            body: bodyOp(op.saveCoins),
            deploy: true,
            success: true,
            outMessagesCount: 1,
        })
        expect(result4.transactions).toHaveTransaction({
            from: wallet.address,
            to: driver.address,
            value: between('0', '0.1'),
            body: bodyOp(op.gasExcess),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result4.transactions).toHaveLength(4)
    })

    it('should set driver', async () => {
        const newDriver = await blockchain.treasury('newDriver')
        const result = await treasury.sendSetDriver(halter.getSender(), { value: '0.1', newDriver: newDriver.address })

        expect(result.transactions).toHaveTransaction({
            from: halter.address,
            to: treasury.address,
            value: toNano('0.1'),
            body: bodyOp(op.setDriver),
            deploy: false,
            success: true,
            outMessagesCount: 1,
        })
        expect(result.transactions).toHaveTransaction({
            from: treasury.address,
            to: halter.address,
            value: between('0', '0.1'),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result.transactions).toHaveLength(3)

        const treasuryState = await treasury.getTreasuryState()
        expect(treasuryState.driver.equals(newDriver.address)).toBeTruthy()
    })

    it('should set content', async () => {
        const newContent = beginCell().storeUint(0, 9).endCell()
        const result = await treasury.sendSetContent(governor.getSender(), { value: '0.1', newContent: newContent })

        expect(result.transactions).toHaveTransaction({
            from: governor.address,
            to: treasury.address,
            value: toNano('0.1'),
            body: bodyOp(op.setContent),
            deploy: false,
            success: true,
            outMessagesCount: 1,
        })
        expect(result.transactions).toHaveTransaction({
            from: treasury.address,
            to: governor.address,
            value: between('0', '0.1'),
            deploy: false,
            success: true,
            outMessagesCount: 0,
        })
        expect(result.transactions).toHaveLength(3)

        const treasuryState = await treasury.getTreasuryState()
        expect(treasuryState.content.equals(newContent)).toBeTruthy()
    })
})