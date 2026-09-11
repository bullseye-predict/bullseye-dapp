// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {OutcomeToken} from "./OutcomeToken.sol";
import {PredictionTypes} from "./interfaces/PredictionTypes.sol";
import {IAgentFillHook} from "./interfaces/IAgentFillHook.sol";

/// @notice A single owner's isolated trading account. No arbitrary calls or agent withdrawals.
/// @dev Session limits are enforced at fill time, including multiple concurrently signed orders.
///      maxCapital is cumulative gross collateral spent per policy epoch, never refilled by sells.
///      maxExposure is a conservative sum of acquired, unredeemed share face values across markets.
///      Telemetry, confidence, slippage, realized-loss and strategy limits belong to the backend.
contract AgentVault is ERC1155Holder, IERC1271, IAgentFillHook, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    struct AgentPolicy {
        address operator;
        uint128 maxCapital;
        uint128 maxOrderSize;
        uint128 maxExposure;
        uint64 expiresAt;
        bool enabled;
    }

    bytes32 public constant AGENT_ORDER_TYPEHASH = keccak256("AgentOrder(bytes32 orderHash,uint256 policyNonce)");
    address public immutable owner;
    IERC20 public immutable collateral;
    PredictionMarket public immutable settlement;
    OutcomeToken public immutable outcomeToken;
    AgentPolicy public policy;
    uint256 public policyNonce;
    uint256 public spentCapital;
    uint256 public grossExposure;
    mapping(bytes32 => bool) public allowedMarket;
    mapping(bytes32 => mapping(uint8 => uint256)) public acquiredShares;

    error OnlyOwner();
    error OnlySettlement();
    error InvalidPolicy();
    error InvalidOrder();
    error AgentNotAuthorized();
    error RiskLimitExceeded();
    error InvalidAmount();

    event Deposit(address indexed from, uint256 amount);
    event Withdrawal(address indexed owner, uint256 amount);
    event PositionWithdrawal(bytes32 indexed marketId, uint8 outcomeId, uint256 amount);
    event AgentPolicyChanged(uint256 indexed policyNonce, address indexed operator, uint128 maxCapital, uint128 maxOrderSize, uint128 maxExposure, uint64 expiresAt, bool enabled);
    event AgentRevoked(uint256 indexed policyNonce);
    event MarketPermissionChanged(bytes32 indexed marketId, bool allowed);
    event AgentFillRecorded(bytes32 indexed orderHash, uint256 cost, uint256 spentCapital, uint256 grossExposure);

    constructor(address owner_, IERC20 collateral_, PredictionMarket settlement_) EIP712("SOLZ Agent Vault", "1") {
        if (owner_ == address(0) || owner_ == address(this) || address(collateral_).code.length == 0
            || address(settlement_).code.length == 0) revert InvalidPolicy();
        owner = owner_;
        collateral = collateral_;
        settlement = settlement_;
        outcomeToken = settlement_.outcomeToken();
        collateral_.forceApprove(address(settlement_), type(uint256).max);
        outcomeToken.setApprovalForAll(address(settlement_), true);
    }

    modifier onlyOwner() { if (msg.sender != owner) revert OnlyOwner(); _; }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = collateral.balanceOf(address(this));
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        if (collateral.balanceOf(address(this)) != beforeBalance + amount) revert InvalidAmount();
        emit Deposit(msg.sender, amount);
    }

    /// @notice Both capital and proceeds always go to the immutable owner. Pauses do not block exits.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _revoke();
        collateral.safeTransfer(owner, amount);
        emit Withdrawal(owner, amount);
    }

    function withdrawPosition(bytes32 marketId, uint8 outcomeId, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _revoke();
        _releaseExposure(marketId, outcomeId, amount);
        outcomeToken.safeTransferFrom(address(this), owner, outcomeToken.tokenId(marketId, outcomeId), amount, "");
        emit PositionWithdrawal(marketId, outcomeId, amount);
    }

    function authorizeAgent(AgentPolicy calldata next) external onlyOwner { _setPolicy(next); }
    function updateAgentPolicy(AgentPolicy calldata next) external onlyOwner { _setPolicy(next); }
    function pauseAgent() external onlyOwner { _revoke(); }
    function revokeAgent() external onlyOwner { _revoke(); }

    function setMarketAllowed(bytes32 marketId, bool allowed) external onlyOwner {
        if (allowed && settlement.getMarket(marketId).collateral != address(collateral)) revert InvalidPolicy();
        allowedMarket[marketId] = allowed;
        // Old signatures cannot be revived by removing then restoring a market permission.
        _revoke();
        emit MarketPermissionChanged(marketId, allowed);
    }

    /// @notice Owner-controlled liquidity preparation; the agent trades existing inventory by signed orders.
    function split(bytes32 marketId, uint256 amount) external onlyOwner nonReentrant {
        PredictionMarket.Market memory market = settlement.getMarket(marketId);
        if (market.collateral != address(collateral)) revert InvalidPolicy();
        grossExposure += amount * market.outcomeCount;
        for (uint8 i; i < market.outcomeCount; ++i) acquiredShares[marketId][i] += amount;
        settlement.split(marketId, amount);
    }

    function merge(bytes32 marketId, uint256 amount) external onlyOwner nonReentrant {
        PredictionMarket.Market memory market = settlement.getMarket(marketId);
        for (uint8 i; i < market.outcomeCount; ++i) _releaseExposure(marketId, i, amount);
        settlement.merge(marketId, amount);
    }

    /// @notice Anyone may redeem into this vault; only its owner can withdraw the proceeds.
    function redeem(bytes32 marketId) external nonReentrant returns (uint256 amount) {
        PredictionMarket.Market memory market = settlement.getMarket(marketId);
        for (uint8 i; i < market.outcomeCount; ++i) _releaseExposure(marketId, i, acquiredShares[marketId][i]);
        amount = settlement.redeem(marketId);
    }

    function cancelOrder(bytes32 orderHash) external {
        _requireController();
        settlement.cancelOrder(orderHash);
    }

    function cancelUpTo(uint256 newMinimumNonce) external {
        _requireController();
        settlement.cancelUpTo(newMinimumNonce);
    }

    /// @dev Signature envelope: abi.encode(Order order, uint256 epoch, bytes signature).
    ///      Owner signs the ordinary settlement order. Agent signs AgentOrder(orderHash, epoch)
    ///      in this vault's EIP-712 domain. An epoch change cannot revive an earlier agent signature.
    function isValidSignature(bytes32 hash, bytes memory envelope) external view returns (bytes4) {
        (PredictionTypes.Order memory order, uint256 epoch, bytes memory signature) =
            abi.decode(envelope, (PredictionTypes.Order, uint256, bytes));
        if (hash != settlement.hashOrder(order) || order.maker != address(this)) return 0xffffffff;
        if (SignatureChecker.isValidSignatureNow(owner, hash, signature)) return IERC1271.isValidSignature.selector;
        if (!_validAgentOrder(order, hash, epoch, signature)) return 0xffffffff;
        return IERC1271.isValidSignature.selector;
    }

    function onOrderFilled(
        PredictionTypes.Order calldata order, bytes calldata envelope, uint128 fillAmount, uint256 cost
    ) external nonReentrant {
        if (msg.sender != address(settlement)) revert OnlySettlement();
        (PredictionTypes.Order memory encoded, uint256 epoch, bytes memory signature) =
            abi.decode(envelope, (PredictionTypes.Order, uint256, bytes));
        bytes32 hash = settlement.hashOrder(order);
        if (hash != settlement.hashOrder(encoded) || order.maker != address(this)
            || settlement.getMarket(order.marketId).collateral != address(collateral)) revert InvalidOrder();
        bool ownerSigned = SignatureChecker.isValidSignatureNow(owner, hash, signature);
        if (!ownerSigned && !_validAgentOrder(order, hash, epoch, signature)) revert AgentNotAuthorized();
        if (order.side == PredictionTypes.BUY) {
            if (!ownerSigned) {
                spentCapital += cost;
                if (spentCapital > policy.maxCapital || grossExposure + fillAmount > policy.maxExposure) revert RiskLimitExceeded();
            }
            acquiredShares[order.marketId][order.outcomeId] += fillAmount;
            grossExposure += fillAmount;
        } else {
            _releaseExposure(order.marketId, order.outcomeId, fillAmount);
        }
        emit AgentFillRecorded(hash, cost, spentCapital, grossExposure);
    }

    function hashAgentOrder(bytes32 orderHash, uint256 epoch) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(AGENT_ORDER_TYPEHASH, orderHash, epoch)));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155Holder) returns (bool) {
        return interfaceId == type(IAgentFillHook).interfaceId || interfaceId == type(IERC1271).interfaceId
            || super.supportsInterface(interfaceId);
    }

    function _validAgentOrder(PredictionTypes.Order memory order, bytes32 hash, uint256 epoch, bytes memory signature)
        private view returns (bool)
    {
        AgentPolicy memory current = policy;
        if (!current.enabled || block.timestamp >= current.expiresAt || epoch != policyNonce
            || order.expiry > current.expiresAt || !allowedMarket[order.marketId]
            || settlement.quote(order.quantity, order.price) > current.maxOrderSize) return false;
        return SignatureChecker.isValidSignatureNow(current.operator, hashAgentOrder(hash, epoch), signature);
    }

    function _setPolicy(AgentPolicy calldata next) private {
        if (next.operator == address(0) || next.operator == address(this) || next.operator == owner
            || next.maxCapital == 0 || next.maxOrderSize == 0 || next.maxOrderSize > next.maxCapital
            || next.maxExposure == 0 || next.maxExposure < grossExposure || next.expiresAt <= block.timestamp) revert InvalidPolicy();
        policy = next;
        ++policyNonce;
        spentCapital = 0;
        emit AgentPolicyChanged(policyNonce, next.operator, next.maxCapital, next.maxOrderSize, next.maxExposure, next.expiresAt, next.enabled);
    }

    function _revoke() private {
        policy.enabled = false;
        ++policyNonce;
        emit AgentRevoked(policyNonce);
    }

    function _requireController() private view {
        if (msg.sender == owner) return;
        if (msg.sender != policy.operator || !policy.enabled || block.timestamp >= policy.expiresAt) revert AgentNotAuthorized();
    }

    function _releaseExposure(bytes32 marketId, uint8 outcomeId, uint256 amount) private {
        uint256 held = acquiredShares[marketId][outcomeId];
        uint256 released = amount < held ? amount : held;
        acquiredShares[marketId][outcomeId] = held - released;
        grossExposure -= released;
    }
}
