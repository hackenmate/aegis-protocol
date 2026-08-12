// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AegisGuard
/// @notice Minimal deterministic policy guard for delegated or smart-account execution.
/// @dev Hackathon MVP. This contract is not audited and should not protect production funds.
contract AegisGuard {
    address public owner;
    uint256 public maxValuePerTx;
    bool public blockUnlimitedApprovals;

    error NotOwner();
    error ValueLimitExceeded(uint256 requested, uint256 maximum);
    error UnlimitedApprovalBlocked();
    error InvalidOwner();

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event PolicyUpdated(uint256 maxValuePerTx, bool blockUnlimitedApprovals);
    event TransactionApproved(address indexed target, uint256 value, bytes4 selector, bytes32 evidenceHash);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner, uint256 initialMaxValuePerTx) {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
        maxValuePerTx = initialMaxValuePerTx;
        blockUnlimitedApprovals = true;
    }

    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        address previous = owner;
        owner = newOwner;
        emit OwnerUpdated(previous, newOwner);
    }

    function setPolicy(uint256 newMaxValuePerTx, bool shouldBlockUnlimitedApprovals) external onlyOwner {
        maxValuePerTx = newMaxValuePerTx;
        blockUnlimitedApprovals = shouldBlockUnlimitedApprovals;
        emit PolicyUpdated(newMaxValuePerTx, shouldBlockUnlimitedApprovals);
    }

    function checkTransaction(address target, uint256 value, bytes calldata data, bytes32 evidenceHash)
        external
        view
        returns (bool allowed)
    {
        target;
        evidenceHash;
        if (value > maxValuePerTx) revert ValueLimitExceeded(value, maxValuePerTx);

        if (blockUnlimitedApprovals && data.length >= 68) {
            bytes4 selector;
            uint256 amount;
            assembly {
                selector := calldataload(data.offset)
                amount := calldataload(add(data.offset, 36))
            }
            if (selector == 0x095ea7b3 && amount == type(uint256).max) {
                revert UnlimitedApprovalBlocked();
            }
        }
        return true;
    }

    function recordApproval(address target, uint256 value, bytes calldata data, bytes32 evidenceHash) external onlyOwner {
        bytes4 selector;
        if (data.length >= 4) {
            assembly { selector := calldataload(data.offset) }
        }
        emit TransactionApproved(target, value, selector, evidenceHash);
    }
}
