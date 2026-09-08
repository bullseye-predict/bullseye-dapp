// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {PredictionMarket} from "./PredictionMarket.sol";

/// @notice Trusted match registration; all venues use this same implementation and different configuration.
contract PredictionMarketFactory is Ownable2Step {
    PredictionMarket public immutable settlement;
    uint8 public maximumOutcomes;
    mapping(address => bool) public allowedCollateral;
    mapping(address => bool) public allowedOracle;
    mapping(bytes32 => bytes32) public marketForMatch;
    mapping(bytes32 => string[]) private _outcomeLabels;

    error InvalidConfiguration();
    error DuplicateMatch();
    event MarketCreated(bytes32 indexed marketId, bytes32 indexed matchId);
    event CollateralAllowed(address indexed collateral, bool allowed);
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
        if (matchId == bytes32(0) || !allowedCollateral[collateral] || !allowedOracle[resultOracle]
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

    function outcomeLabels(bytes32 marketId) external view returns (string[] memory) {
        return _outcomeLabels[marketId];
    }

    function setAllowedCollateral(address collateral, bool allowed) external onlyOwner {
        if (allowed && collateral.code.length == 0) revert InvalidConfiguration();
        allowedCollateral[collateral] = allowed;
        emit CollateralAllowed(collateral, allowed);
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
