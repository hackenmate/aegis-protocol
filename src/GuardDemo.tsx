import { useMemo, useState } from 'react';
import { BrowserProvider, Contract, ContractFactory, Interface, MaxUint256, parseEther } from 'ethers';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, LockKeyhole, Rocket, Shield, Wallet } from 'lucide-react';
import { AEGIS_GUARD_ABI, AEGIS_GUARD_BYTECODE } from './guardArtifact';

const ARBITRUM_SEPOLIA = {
  chainId: '0x66eee',
  chainName: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
  blockExplorerUrls: ['https://sepolia.arbiscan.io'],
};

const ERC20 = new Interface(['function approve(address spender,uint256 amount)']);
const DEMO_TOKEN = '0x1111111111111111111111111111111111111111';
const DEMO_SPENDER = '0x2222222222222222222222222222222222222222';

function getEthereum() {
  const ethereum = (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!ethereum) throw new Error('No EVM wallet detected. Install MetaMask or another browser wallet.');
  return ethereum;
}

export default function GuardDemo() {
  const [account, setAccount] = useState('');
  const [guardAddress, setGuardAddress] = useState(localStorage.getItem('aegis.guard.address') || '');
  const [status, setStatus] = useState<'idle'|'working'|'success'|'blocked'|'error'>('idle');
  const [message, setMessage] = useState('Ready. Connect a wallet on Arbitrum Sepolia.');
  const [txHash, setTxHash] = useState('');

  const explorer = useMemo(() => txHash ? `https://sepolia.arbiscan.io/tx/${txHash}` : '', [txHash]);

  async function providerAndSigner() {
    const ethereum = getEthereum();
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARBITRUM_SEPOLIA.chainId }] });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902) throw error;
      await ethereum.request({ method: 'wallet_addEthereumChain', params: [ARBITRUM_SEPOLIA] });
    }
    const provider = new BrowserProvider(ethereum as never);
    const signer = await provider.getSigner();
    return { provider, signer };
  }

  async function connect() {
    setStatus('working'); setMessage('Connecting wallet…'); setTxHash('');
    try {
      const { signer } = await providerAndSigner();
      const address = await signer.getAddress();
      setAccount(address); setStatus('success'); setMessage('Wallet connected to Arbitrum Sepolia.');
    } catch (e) { setStatus('error'); setMessage(e instanceof Error ? e.message : 'Wallet connection failed.'); }
  }

  async function deploy() {
    setStatus('working'); setMessage('Creating AegisGuard deployment transaction…'); setTxHash('');
    try {
      const { signer } = await providerAndSigner();
      const owner = await signer.getAddress();
      setAccount(owner);
      const factory = new ContractFactory(AEGIS_GUARD_ABI, AEGIS_GUARD_BYTECODE, signer);
      const guard = await factory.deploy(owner, parseEther('0.01'));
      const deploymentTx = guard.deploymentTransaction();
      if (deploymentTx?.hash) setTxHash(deploymentTx.hash);
      setMessage('Deployment submitted. Waiting for Arbitrum Sepolia confirmation…');
      await guard.waitForDeployment();
      const address = await guard.getAddress();
      localStorage.setItem('aegis.guard.address', address);
      setGuardAddress(address); setStatus('success'); setMessage(`AegisGuard deployed at ${address}`);
    } catch (e) { setStatus('error'); setMessage(e instanceof Error ? e.message : 'Contract deployment failed.'); }
  }

  async function proveBlock() {
    if (!guardAddress) { setStatus('error'); setMessage('Deploy or enter an AegisGuard address first.'); return; }
    setStatus('working'); setMessage('Simulating a maximum ERC-20 approval through AegisGuard…'); setTxHash('');
    try {
      const { signer } = await providerAndSigner();
      const guard = new Contract(guardAddress, AEGIS_GUARD_ABI, signer);
      const maliciousCalldata = ERC20.encodeFunctionData('approve', [DEMO_SPENDER, MaxUint256]);
      await guard.enforce.staticCall(DEMO_TOKEN, 0n, maliciousCalldata, '0x' + '11'.repeat(32));
      setStatus('error'); setMessage('Unexpected: the unlimited approval was not blocked. Do not use this deployment.');
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (text.includes('UnlimitedApprovalBlocked') || text.includes('execution reverted')) {
        setStatus('blocked'); setMessage('PROOF COMPLETE: AegisGuard reverted the unlimited approval before execution. No dangerous transaction was broadcast.');
      } else { setStatus('error'); setMessage(text); }
    }
  }

  async function sendSafeProof() {
    if (!guardAddress) { setStatus('error'); setMessage('Deploy or enter an AegisGuard address first.'); return; }
    setStatus('working'); setMessage('Sending a zero-value safe call through AegisGuard…'); setTxHash('');
    try {
      const { signer } = await providerAndSigner();
      const guard = new Contract(guardAddress, AEGIS_GUARD_ABI, signer);
      const tx = await guard.enforce(DEMO_TOKEN, 0n, '0x', '0x' + '22'.repeat(32));
      setTxHash(tx.hash); await tx.wait(); setStatus('success'); setMessage('Safe transaction passed the policy and was recorded onchain.');
    } catch (e) { setStatus('error'); setMessage(e instanceof Error ? e.message : 'Safe proof transaction failed.'); }
  }

  return <div className='guard-shell'>
    <header><a href='/' className='guard-brand'><span><Shield size={20}/></span><div><b>AEGIS</b><small>ONCHAIN ENFORCEMENT LAB</small></div></a><div className='chain-chip'>Arbitrum Sepolia · 421614</div></header>
    <main>
      <section className='guard-hero'><div className='eyebrow'>LIVE SMART-CONTRACT PROOF</div><h1>Detect the risk. <em>Make it revert.</em></h1><p>This page deploys the AEGIS policy boundary from your own browser wallet. The dangerous demo uses <code>eth_call</code>-style simulation against the deployed contract, so the proof shows a real Solidity revert without broadcasting the blocked approval.</p></section>
      <section className='guard-grid'>
        <div className='guard-card'><div className='card-head'><div><small>STEP 01</small><h2>Connect</h2></div><Wallet size={20}/></div><p>Your wallet remains the signer. AEGIS never receives your private key.</p><button onClick={connect} disabled={status==='working'}><Wallet size={16}/> Connect wallet</button><code className='address'>{account || 'not connected'}</code></div>
        <div className='guard-card'><div className='card-head'><div><small>STEP 02</small><h2>Deploy Guard</h2></div><Rocket size={20}/></div><p>Deploy with a 0.01 ETH per-transaction ceiling plus approval protections enabled.</p><button onClick={deploy} disabled={status==='working'}><Rocket size={16}/> Deploy AegisGuard</button><input value={guardAddress} onChange={e=>{setGuardAddress(e.target.value);localStorage.setItem('aegis.guard.address',e.target.value)}} placeholder='0x… deployed address'/></div>
        <div className='guard-card danger-card'><div className='card-head'><div><small>STEP 03</small><h2>Prove the block</h2></div><LockKeyhole size={20}/></div><p>Try an ERC-20 <code>approve(spender, uint256.max)</code>. The contract must revert with <code>UnlimitedApprovalBlocked</code>.</p><button className='danger' onClick={proveBlock} disabled={status==='working'}><LockKeyhole size={16}/> Simulate dangerous approval</button></div>
        <div className='guard-card'><div className='card-head'><div><small>OPTIONAL</small><h2>Record a pass</h2></div><CheckCircle2 size={20}/></div><p>Broadcast a zero-value safe call through the guard to create an onchain success transaction.</p><button onClick={sendSafeProof} disabled={status==='working'}><CheckCircle2 size={16}/> Send safe proof</button></div>
      </section>
      <section className={`status-card ${status}`}><div className='status-icon'>{status==='working'?<Loader2 className='spin'/>:status==='blocked'?<LockKeyhole/>:status==='error'?<AlertTriangle/>:<CheckCircle2/>}</div><div><small>AEGIS EXECUTION STATUS</small><strong>{message}</strong>{explorer && <a href={explorer} target='_blank' rel='noreferrer'>View transaction <ExternalLink size={13}/></a>}</div></section>
      <section className='proof-note'><b>What this proves</b><p>The offchain analyst can recommend a decision, but the Solidity policy can independently reject a forbidden transaction. For production, this same boundary should be integrated into a smart-account Guard/Hook and audited before protecting real funds.</p></section>
    </main>
  </div>;
}
