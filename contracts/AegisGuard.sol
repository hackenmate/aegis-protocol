// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AegisGuard
/// @notice Deterministic execution boundary for AEGIS-protected transactions.
/// @dev Hackathon MVP. Not audited. Do not use to protect production funds.
contract AegisGuard {
    address public owner;
    uint256 public maxValuePerTx;
    bool public blockUnlimitedApprovals;
    bool public blockApprovalForAll;

    error NotOwner();
    error InvalidOwner();
    error InvalidTarget();
    error ValueLimitExceeded(uint256 requested, uint256 maximum);
    error UnlimitedApprovalBlocked();
    error ApprovalForAllBlocked();
    error TargetCallFailed(bytes returnData);

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event PolicyUpdated(uint256 maxValuePerTx, bool blockUnlimitedApprovals, bool blockApprovalForAll);
    event TransactionAllowed(
        address indexed target,
        uint256 value,
        bytes4 selector,
        bytes32 indexed evidenceHash
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner, uint256 initialMaxValuePerTx) {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
        maxValuePerTx = initialMaxValuePerTx;
        blockUnlimitedApprovals = true;
        blockApprovalForAll = true;
    }

    receive() external payable {}

    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        address previous = owner;
        owner = newOwner;
        emit OwnerUpdated(previous, newOwner);
    }

    function setPolicy(
        uint256 newMaxValuePerTx,
        bool shouldBlockUnlimitedApprovals,
        bool shouldBlockApprovalForAll
    ) external onlyOwner {
        maxValuePerTx = newMaxValuePerTx;
        blockUnlimitedApprovals = shouldBlockUnlimitedApprovals;
        blockApprovalForAll = shouldBlockApprovalForAll;
        emit PolicyUpdated(newMaxValuePerTx, shouldBlockUnlimitedApprovals, shouldBlockApprovalForAll);
    }

    /// @notice Evaluates the exact transaction parameters without executing them.
    function checkTransaction(address target, uint256 value, bytes calldata data)
        public
        view
        returns (bool allowed)
    {
        _validate(target, value, data);
        return true;
    }

    /// @notice Executes a transaction only after the deterministic AEGIS policy accepts it.
    /// @dev This function is deliberately small so the hackathon demo can prove a real onchain revert.
    ///      Production integrations should place equivalent policy logic inside a compatible smart-account Guard/Hook.
    function enforce(address target, uint256 value, bytes calldata data, bytes32 evidenceHash)
        external
        onlyOwner
        returns (bytes memory returnData)
    {
        bytes4 selector = _validate(target, value, data);

        (bool ok, bytes memory response) = target.call{value: value}(data);
        if (!ok) revert TargetCallFailed(response);

        emit TransactionAllowed(target, value, selector, evidenceHash);
        return response;
    }

    function _validate(address target, uint256 value, bytes calldata data)
        internal
        view
        returns (bytes4 selector)
    {
        if (target == address(0) || target == address(this)) revert InvalidTarget();
        if (value > maxValuePerTx) revert ValueLimitExceeded(value, maxValuePerTx);

        if (data.length >= 4) {
            assembly {
                selector := calldataload(data.offset)
            }
        }

        // ERC-20 approve(address,uint256)
        if (blockUnlimitedApprovals && selector == 0x095ea7b3 && data.length >= 68) {
            uint256 amount;
            assembly {
                amount := calldataload(add(data.offset, 36))
            }
            if (amount == type(uint256).max) revert UnlimitedApprovalBlocked();
        }

        // ERC-721/ERC-1155 setApprovalForAll(address,bool)
        if (blockApprovalForAll && selector == 0xa22cb465 && data.length >= 68) {
            uint256 approved;
            assembly {
                approved := calldataload(add(data.offset, 36))
            }
            if (approved != 0) revert ApprovalForAllBlocked();
        }
    }
}
