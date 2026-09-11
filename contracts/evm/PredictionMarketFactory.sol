// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {MatchIdentity} from "./MatchIdentity.sol";

/// @notice Trusted match registration; all venues use this same implementation and different configuration.
contract PredictionMarketFactory is Ownable2Step {
    PredictionMarket public immutable settlement;
    uint8 public maximumOutcomes;
    mapping(address => bool) public allowedCollateral;
    /// @notice Permanently excludes assets that belong to a separate product flow (for example COOLA prompts).
    mapping(address => bool) public blockedCollateral;
    mapping(address => bool) public allowedOracle;
    mapping(bytes32 => bytes32) public marketForMatch;
    mapping(bytes32 => mapping(bytes32 => bytes32)) public marketForQuestion;
    mapping(bytes32 => string[]) private _outcomeLabels;
    address public lazyCollateral;
    address public lazyOracle;
    uint64 public lazySettlementWindow;

    error InvalidConfiguration();
    error DuplicateMatch();
    error DuplicateQuestion();
    event MarketCreated(bytes32 indexed marketId, bytes32 indexed matchId);
    event QuestionMarketCreated(bytes32 indexed marketId, bytes32 indexed matchId, bytes32 indexed questionId, uint8 questionKind);
    event LazyMarketConfigurationChanged(address indexed collateral, address indexed oracle, uint64 settlementWindow);
    event CollateralAllowed(address indexed collateral, bool allowed);
    event CollateralBlocked(address indexed collateral);
    event OracleAllowed(address indexed oracle, bool allowed);
    event MaximumOutcomesChanged(uint8 maximumOutcomes);

    constructor(address initialOwner, uint8 maximumOutcomes_) Ownable(initialOwner) {
        _setMaximumOutcomes(maximumOutcomes_);
        settlement = new PredictionMarket(initialOwner, address(this));
    }

    function createMarket(
        bytes32 matchId, address collateral, string[] calldata outcomes,
        uint64 tradingLockTime, uint64 expiry, address resultOracle
    ) external onlyOwner returns (bytes32 marketId) {
        if (marketForMatch[matchId] != bytes32(0)) revert DuplicateMatch();
        if (matchId == bytes32(0) || !allowedCollateral[collateral] || blockedCollateral[collateral] || !allowedOracle[resultOracle]
            || outcomes.length < 2 || outcomes.length > maximumOutcomes) revert InvalidConfiguration();
        marketId = keccak256(abi.encode(block.chainid, address(this), matchId));
        for (uint256 i; i < outcomes.length; ++i) {
            if (bytes(outcomes[i]).length == 0 || bytes(outcomes[i]).length > 64) revert InvalidConfiguration();
            for (uint256 j; j < i; ++j) {
                if (keccak256(bytes(outcomes[i])) == keccak256(bytes(outcomes[j]))) revert InvalidConfiguration();
            }
            _outcomeLabels[marketId].push(outcomes[i]);
        }
        marketForMatch[matchId] = marketId;
        settlement.registerMarket(marketId, matchId, collateral, uint8(outcomes.length), tradingLockTime, expiry, resultOracle);
        emit MarketCreated(marketId, matchId);
    }

    /// @notice One-time venue policy used by permissionless first-trader creation.
    /// @dev It can be set only once, after its collateral and oracle are allowlisted.
    function configureLazyMarkets(address collateral, address resultOracle, uint64 settlementWindow) external onlyOwner {
        if (lazyCollateral != address(0) || !allowedCollateral[collateral] || blockedCollateral[collateral] || !allowedOracle[resultOracle]
            || settlementWindow == 0) revert InvalidConfiguration();
        lazyCollateral = collateral;
        lazyOracle = resultOracle;
        lazySettlementWindow = settlementWindow;
        emit LazyMarketConfigurationChanged(collateral, resultOracle, settlementWindow);
    }

    /// @notice Permissionlessly creates exactly one binary question market.
    /// The caller pays gas. Collateral, oracle, lock and expiry cannot be chosen
    /// by the caller: they come from venue policy and the canonical matchId.
    function createQuestionMarket(bytes32 matchId, bytes32 questionId) external returns (bytes32 marketId) {
        if (marketForQuestion[matchId][questionId] != bytes32(0)) revert DuplicateQuestion();
        if (lazyCollateral == address(0) || lazyOracle == address(0)) revert InvalidConfiguration();
        MatchIdentity.MatchConfig memory matchConfig = MatchIdentity.decodeMatch(matchId);
        uint8 kind = MatchIdentity.questionKind(questionId);
        if (block.timestamp >= matchConfig.kickoff) revert InvalidConfiguration();

        uint256 expiryValue = uint256(matchConfig.kickoff)
            + uint256(matchConfig.durationMinutes) * 60
            + uint256(lazySettlementWindow);
        if (expiryValue > type(uint64).max) revert InvalidConfiguration();

        marketId = MatchIdentity.marketId(address(this), matchId, questionId);
        marketForQuestion[matchId][questionId] = marketId;
        _outcomeLabels[marketId].push("YES");
        _outcomeLabels[marketId].push("NO");
        settlement.registerMarket(
            marketId, matchId, lazyCollateral, 2, matchConfig.kickoff, uint64(expiryValue), lazyOracle
        );
        emit MarketCreated(marketId, matchId);
        emit QuestionMarketCreated(marketId, matchId, questionId, kind);
    }

    function outcomeLabels(bytes32 marketId) external view returns (string[] memory) {
        return _outcomeLabels[marketId];
    }

    function setAllowedCollateral(address collateral, bool allowed) external onlyOwner {
        if (allowed && (collateral.code.length == 0 || blockedCollateral[collateral])) revert InvalidConfiguration();
        allowedCollateral[collateral] = allowed;
        emit CollateralAllowed(collateral, allowed);
    }

    /// @notice This operation is intentionally irreversible for a deployed factory.
    /// @dev Use it during deployment to ensure the COOLA game-execution token can never collateralize prediction positions.
    function blockCollateral(address collateral) external onlyOwner {
        if (collateral.code.length == 0 || blockedCollateral[collateral]) revert InvalidConfiguration();
        blockedCollateral[collateral] = true;
        allowedCollateral[collateral] = false;
        emit CollateralBlocked(collateral);
        emit CollateralAllowed(collateral, false);
    }

    function setAllowedOracle(address oracle, bool allowed) external onlyOwner {
        if (allowed && oracle.code.length == 0) revert InvalidConfiguration();
        allowedOracle[oracle] = allowed;
        emit OracleAllowed(oracle, allowed);
    }

    function setMaximumOutcomes(uint8 value) external onlyOwner { _setMaximumOutcomes(value); }

    function _setMaximumOutcomes(uint8 value) private {
        if (value < 2 || value > 16) revert InvalidConfiguration();
        maximumOutcomes = value;
        emit MaximumOutcomesChanged(value);
    }
}
