# AEGIS Protocol

**Intent-bound security for autonomous Web3 transactions.**

AEGIS is a defensive transaction firewall designed for wallets and AI agents that can propose or execute blockchain actions. The MVP compares the user's stated intent with transaction calldata, deterministic policy checks, live Arbitrum Sepolia execution evidence, and an AI semantic review before returning one of three decisions:

- `ALLOW`
- `REQUIRE_HUMAN`
- `BLOCK`

> Core principle: **AI can recommend; policy must authorize.**

## Live MVP

Public demo: https://aegis-6kv1tl.v2.appdeploy.ai/

Network used by the MVP: **Arbitrum Sepolia**.

## What the MVP currently does

- Binds a natural-language human intent to a proposed transaction.
- Validates EVM addresses, ETH value and calldata format.
- Detects selected risky patterns such as ERC-20 unlimited approvals and `setApprovalForAll`.
- Checks transaction value against a deterministic maximum policy.
- Queries Arbitrum Sepolia with `eth_blockNumber`, `eth_getCode`, `eth_call`, `eth_estimateGas` and `eth_getStorageAt`.
- Detects a populated EIP-1967 implementation slot as an upgradeability signal.
- Compares `eth_call` behavior across adjacent block states as an early state-sensitivity probe.
- Uses structured AI review to compare the requested intent with deterministic findings.
- Keeps deterministic rules as the final authority for blocking hard policy violations.
- Produces a decision fingerprint for demo/evidence tracking.

## Architecture

```text
Human Intent
    |
    v
Intent Binding
    |
    v
Transaction Proposal
    |
    +--> Deterministic Decoder
    +--> Policy Engine
    +--> Arbitrum RPC Simulation
    +--> State-Sensitivity Probe
    +--> AI Semantic Review
    |
    v
ALLOW / REQUIRE_HUMAN / BLOCK
```

## Hackathon direction

The current MVP is intentionally focused on the pre-sign security workflow. The production roadmap expands the system with:

1. Universal ABI/source resolution and contract intelligence.
2. EIP-7702 delegated-account detection.
3. Adversarial multi-state simulation and state diffs.
4. Cryptographic decision attestations.
5. Safe / modular smart-account enforcement on Arbitrum.
6. Agent-scoped permissions, spend limits and protocol allowlists.

## Demo scenario

The fastest demo is the **Approval risk** flow:

1. Human intent says to swap a bounded amount and never grant unlimited approval.
2. The proposed calldata requests a maximum ERC-20 allowance.
3. AEGIS decodes the mismatch and queries live chain evidence.
4. The AI review explains the semantic conflict.
5. Deterministic policy returns `BLOCK` or requires human review.

## Project structure

```text
src/
  AegisApp.tsx       Main React MVP
  index.css          UI and responsive design
backend/
  aegis.ts           Transaction analysis engine
  index.ts           API router
  realtime*.ts       AppDeploy runtime support
 tests/
  tests.txt          End-to-end QA scenarios
```

## Runtime note

The live prototype is deployed with **AppDeploy**. The frontend imports `@appdeploy/client` and the backend imports `@appdeploy/sdk`; these runtime modules are supplied by that deployment environment and are intentionally not listed as normal npm dependencies in this snapshot.

For a fully standalone deployment, replace those transport/AI adapters with your preferred API server and model provider while keeping the AEGIS policy engine logic.

## Security status

This repository is a **hackathon MVP, not an audited security product**. Do not use it as the sole control for production funds. The current decision fingerprint is an MVP identifier and is not yet an on-chain cryptographic attestation.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind/PostCSS
- Arbitrum Sepolia JSON-RPC
- AI semantic analysis
- AppDeploy frontend/backend runtime

---

AEGIS explores a simple thesis: as AI agents gain the ability to control programmable money, they need an independent execution boundary between intelligence and authority.
