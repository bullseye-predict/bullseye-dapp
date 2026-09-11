// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library PredictionTypes {
    uint256 internal constant PRICE_SCALE = 1_000_000;
    uint8 internal constant BUY = 0;
    uint8 internal constant SELL = 1;

    enum MarketStatus { PENDING, TRADING, LOCKED, RESOLVED, VOIDED }

    struct Order {
        address maker;
        bytes32 marketId;
        uint8 outcomeId;
        uint8 side;
        uint64 price;
        uint128 quantity;
        uint256 nonce;
        uint64 expiry;
    }

    struct Result {
        bytes32 matchId;
        bytes32 marketId;
        uint8 winningOutcomeId;
        bool voided;
        bytes32 stateHash;
        uint64 finishedAt;
        uint64 expiry;
    }
}
