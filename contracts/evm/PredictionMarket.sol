// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {OutcomeToken} from "./OutcomeToken.sol";
import {PredictionTypes} from "./interfaces/PredictionTypes.sol";
import {IAgentFillHook} from "./interfaces/IAgentFillHook.sol";

/// @notice Collateral ledger and permissionless settlement for off-chain, EIP-712 orders.
/// @dev Collateral must be a governance-approved, non-rebasing ERC20 without transfer fees.
contract PredictionMarket is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ERC165Checker for address;

    uint256 public constant PRICE_SCALE = 1_000_000;
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,bytes32 marketId,uint8 outcomeId,uint8 side,uint64 price,uint128 quantity,uint256 nonce,uint64 expiry)"
    );
    address public immutable factory;
    OutcomeToken public immutable outcomeToken;

    struct Market {
        bytes32 matchId;
        address collateral;
        uint64 createdAt;
        uint64 tradingLockTime;
        uint64 expiry;
        uint8 outcomeCount;
        address resultOracle;
        PredictionTypes.MarketStatus status;
        bool paused;
        uint8 winningOutcomeId;
        uint256 collateralLocked;
        uint256 voidSharesRedeemed;
    }

    mapping(bytes32 => Market) private _markets;
    mapping(bytes32 => uint128) public filledQuantity;
    mapping(address => mapping(bytes32 => bool)) public cancelled;
    mapping(address => uint256) public minimumNonce;

    error OnlyFactory();
    error InvalidMarket();
    error MarketNotTrading();
    error InvalidAmount();
    error InvalidOrder();
    error InvalidSignature();
    error InvalidResult();
    error AlreadyFinalized();
    error NotFinalized();
    error UnsupportedCollateral();
    error InvalidNonce();

    event MarketRegistered(bytes32 indexed marketId, bytes32 indexed matchId, address collateral, uint8 outcomeCount);
    event PositionSplit(bytes32 indexed marketId, address indexed account, uint256 amount);
    event PositionMerged(bytes32 indexed marketId, address indexed account, uint256 amount);
    event PositionRedeemed(bytes32 indexed marketId, address indexed account, uint256 collateralAmount, uint256 sharesBurned);
    event MarketResolved(bytes32 indexed marketId, uint8 winningOutcomeId, bytes32 stateHash);
    event MarketVoided(bytes32 indexed marketId, bytes32 stateHash);
    event MarketPauseChanged(bytes32 indexed marketId, bool paused);
    event OrderCancelled(address indexed maker, bytes32 indexed orderHash);
    event MinimumNonceChanged(address indexed maker, uint256 minimumNonce);
    event TradeExecuted(
        bytes32 indexed marketId, bytes32 indexed buyOrderHash, bytes32 indexed sellOrderHash,
        address buyer, address seller, uint8 outcomeId, uint64 price, uint128 quantity, uint256 collateralAmount
    );

    constructor(address initialOwner, address factory_)
        Ownable(initialOwner) EIP712("SOLZ Prediction Market", "1")
    {
        if (factory_ == address(0)) revert InvalidMarket();
        factory = factory_;
        outcomeToken = new OutcomeToken(address(this));
    }

    function registerMarket(
        bytes32 marketId, bytes32 matchId, address collateral, uint8 outcomeCount,
        uint64 tradingLockTime, uint64 expiry, address resultOracle
    ) external whenNotPaused {
        if (msg.sender != factory) revert OnlyFactory();
        if (_markets[marketId].collateral != address(0) || marketId == bytes32(0) || matchId == bytes32(0)
            || collateral.code.length == 0 || resultOracle.code.length == 0 || outcomeCount < 2 || outcomeCount > 16
            || tradingLockTime <= block.timestamp || expiry <= tradingLockTime) revert InvalidMarket();
        _markets[marketId] = Market({
            matchId: matchId, collateral: collateral, createdAt: uint64(block.timestamp),
            tradingLockTime: tradingLockTime, expiry: expiry, outcomeCount: outcomeCount,
            resultOracle: resultOracle, status: PredictionTypes.MarketStatus.TRADING,
            paused: false, winningOutcomeId: 0, collateralLocked: 0, voidSharesRedeemed: 0
        });
        emit MarketRegistered(marketId, matchId, collateral, outcomeCount);
    }

    function getMarket(bytes32 marketId) external view returns (Market memory market) {
        market = _market(marketId);
        if (market.status == PredictionTypes.MarketStatus.TRADING && block.timestamp >= market.tradingLockTime) {
            market.status = PredictionTypes.MarketStatus.LOCKED;
        }
    }

    function split(bytes32 marketId, uint256 amount) external nonReentrant whenNotPaused {
        Market storage market = _market(marketId);
        _requireTrading(market);
        if (amount == 0 || amount > type(uint256).max / market.outcomeCount - market.collateralLocked) revert InvalidAmount();
        market.collateralLocked += amount;
        _receiveExact(IERC20(market.collateral), msg.sender, address(this), amount);
        outcomeToken.mintSet(msg.sender, marketId, market.outcomeCount, amount);
        emit PositionSplit(marketId, msg.sender, amount);
    }

    /// @notice Complete-set exits remain available while paused and after the trading cutoff.
    function merge(bytes32 marketId, uint256 amount) external nonReentrant {
        Market storage market = _market(marketId);
        if (_isFinal(market)) revert AlreadyFinalized();
        if (amount == 0) revert InvalidAmount();
        market.collateralLocked -= amount;
        outcomeToken.burnSet(msg.sender, marketId, market.outcomeCount, amount);
        _sendExact(IERC20(market.collateral), msg.sender, amount);
        emit PositionMerged(marketId, msg.sender, amount);
    }

    /// @notice Burns all of the caller's positions. A winner pays one collateral unit per share.
    /// @dev Voids pay 1/N per outcome. A global fractional remainder carries between redeemers:
    ///      floor((previouslyBurned + shares)/N) - floor(previouslyBurned/N). Redeemer ordering can
    ///      move at most one atomic collateral unit; burning every share returns every locked unit.
    function redeem(bytes32 marketId) external nonReentrant returns (uint256 payout) {
        Market storage market = _market(marketId);
        if (!_isFinal(market)) revert NotFinalized();
        uint256[] memory amounts = new uint256[](market.outcomeCount);
        uint256 shares;
        for (uint8 i; i < market.outcomeCount; ++i) {
            amounts[i] = outcomeToken.balanceOf(msg.sender, outcomeToken.tokenId(marketId, i));
            shares += amounts[i];
        }
        if (shares == 0) revert InvalidAmount();
        if (market.status == PredictionTypes.MarketStatus.RESOLVED) {
            payout = amounts[market.winningOutcomeId];
        } else {
            uint256 previous = market.voidSharesRedeemed;
            market.voidSharesRedeemed = previous + shares;
            payout = market.voidSharesRedeemed / market.outcomeCount - previous / market.outcomeCount;
        }
        market.collateralLocked -= payout;
        outcomeToken.burnPositions(msg.sender, marketId, amounts);
        if (payout != 0) _sendExact(IERC20(market.collateral), msg.sender, payout);
        emit PositionRedeemed(marketId, msg.sender, payout, shares);
    }

    function finalize(PredictionTypes.Result calldata result) external nonReentrant {
        Market storage market = _market(result.marketId);
        if (msg.sender != market.resultOracle || result.matchId != market.matchId
            || result.finishedAt < market.createdAt || result.finishedAt > block.timestamp
            || block.timestamp >= market.expiry) revert InvalidResult();
        if (_isFinal(market)) revert AlreadyFinalized();
        if (result.voided) {
            market.status = PredictionTypes.MarketStatus.VOIDED;
            emit MarketVoided(result.marketId, result.stateHash);
        } else {
            if (result.winningOutcomeId >= market.outcomeCount) revert InvalidResult();
            market.status = PredictionTypes.MarketStatus.RESOLVED;
            market.winningOutcomeId = result.winningOutcomeId;
            emit MarketResolved(result.marketId, result.winningOutcomeId, result.stateHash);
        }
    }

    /// @notice An unavailable oracle cannot lock collateral forever. Expiry is fixed at creation.
    function voidExpiredMarket(bytes32 marketId) external nonReentrant {
        Market storage market = _market(marketId);
        if (_isFinal(market)) revert AlreadyFinalized();
        if (block.timestamp < market.expiry) revert InvalidResult();
        market.status = PredictionTypes.MarketStatus.VOIDED;
        emit MarketVoided(marketId, bytes32(0));
    }

    function fillOrders(
        PredictionTypes.Order calldata buy, bytes calldata buySignature,
        PredictionTypes.Order calldata sell, bytes calldata sellSignature, uint128 fillAmount
    ) external nonReentrant whenNotPaused {
        Market storage market = _market(buy.marketId);
        _requireTrading(market);
        if (buy.side != PredictionTypes.BUY || sell.side != PredictionTypes.SELL || buy.maker == sell.maker
            || buy.marketId != sell.marketId || buy.outcomeId != sell.outcomeId || buy.price < sell.price
            || fillAmount == 0) revert InvalidOrder();
        bytes32 buyHash = _validateOrder(buy, buySignature, market.outcomeCount, fillAmount);
        bytes32 sellHash = _validateOrder(sell, sellSignature, market.outcomeCount, fillAmount);
        filledQuantity[buyHash] += fillAmount;
        filledQuantity[sellHash] += fillAmount;
        uint256 cost = quote(fillAmount, sell.price);
        // Atomic collateral rounding must never exceed the buyer's signed per-fill limit.
        if (cost * PRICE_SCALE > uint256(fillAmount) * buy.price) revert InvalidOrder();
        _notifyVault(buy, buySignature, fillAmount, cost);
        _notifyVault(sell, sellSignature, fillAmount, cost);
        _receiveExact(IERC20(market.collateral), buy.maker, sell.maker, cost);
        outcomeToken.safeTransferFrom(sell.maker, buy.maker, outcomeToken.tokenId(buy.marketId, buy.outcomeId), fillAmount, "");
        emit TradeExecuted(buy.marketId, buyHash, sellHash, buy.maker, sell.maker, buy.outcomeId, sell.price, fillAmount, cost);
    }

    /// @notice Each fill rounds the signed price upward to one atomic collateral unit.
    function quote(uint128 amount, uint64 price) public pure returns (uint256) {
        return (uint256(amount) * price + PRICE_SCALE - 1) / PRICE_SCALE;
    }

    function hashOrder(PredictionTypes.Order memory order) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            ORDER_TYPEHASH, order.maker, order.marketId, order.outcomeId, order.side, order.price,
            order.quantity, order.nonce, order.expiry
        )));
    }

    function cancelOrder(bytes32 orderHash) external {
        cancelled[msg.sender][orderHash] = true;
        emit OrderCancelled(msg.sender, orderHash);
    }

    function cancelUpTo(uint256 newMinimumNonce) external {
        if (newMinimumNonce <= minimumNonce[msg.sender]) revert InvalidNonce();
        minimumNonce[msg.sender] = newMinimumNonce;
        emit MinimumNonceChanged(msg.sender, newMinimumNonce);
    }

    function setPaused(bool value) external onlyOwner { if (value) _pause(); else _unpause(); }

    function setMarketPaused(bytes32 marketId, bool value) external onlyOwner {
        _market(marketId).paused = value;
        emit MarketPauseChanged(marketId, value);
    }

    function _validateOrder(PredictionTypes.Order calldata order, bytes calldata signature, uint8 count, uint128 amount)
        private view returns (bytes32 digest)
    {
        digest = hashOrder(order);
        if (order.maker == address(0) || order.outcomeId >= count || order.price == 0 || order.price > PRICE_SCALE
            || order.quantity == 0 || order.expiry <= block.timestamp || order.nonce < minimumNonce[order.maker]
            || cancelled[order.maker][digest] || amount > order.quantity - filledQuantity[digest]) revert InvalidOrder();
        if (!SignatureChecker.isValidSignatureNow(order.maker, digest, signature)) revert InvalidSignature();
    }

    function _notifyVault(PredictionTypes.Order calldata order, bytes calldata signature, uint128 amount, uint256 cost) private {
        if (order.maker.supportsInterface(type(IAgentFillHook).interfaceId)) {
            IAgentFillHook(order.maker).onOrderFilled(order, signature, amount, cost);
        }
    }

    function _market(bytes32 marketId) private view returns (Market storage market) {
        market = _markets[marketId];
        if (market.collateral == address(0)) revert InvalidMarket();
    }

    function _requireTrading(Market storage market) private view {
        if (market.paused || market.status != PredictionTypes.MarketStatus.TRADING
            || block.timestamp >= market.tradingLockTime) revert MarketNotTrading();
    }

    function _isFinal(Market storage market) private view returns (bool) {
        return market.status == PredictionTypes.MarketStatus.RESOLVED || market.status == PredictionTypes.MarketStatus.VOIDED;
    }

    function _receiveExact(IERC20 token, address from, address to, uint256 amount) private {
        uint256 beforeFrom = token.balanceOf(from);
        uint256 beforeTo = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        if (token.balanceOf(to) != beforeTo + amount || token.balanceOf(from) + amount != beforeFrom) revert UnsupportedCollateral();
    }

    function _sendExact(IERC20 token, address to, uint256 amount) private {
        uint256 beforeFrom = token.balanceOf(address(this));
        uint256 beforeTo = token.balanceOf(to);
        token.safeTransfer(to, amount);
        if (token.balanceOf(to) != beforeTo + amount || token.balanceOf(address(this)) + amount != beforeFrom) revert UnsupportedCollateral();
    }
}
