// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Canonical, self-describing identities used by permissionless lazy markets.
library MatchIdentity {
    bytes4 internal constant MATCH_MAGIC = 0x534f4c5a; // "SOLZ"
    bytes4 internal constant QUESTION_MAGIC = 0x51554553; // "QUES"
    uint8 internal constant VERSION = 1;
    uint8 internal constant WINNER_QUESTION = 1;

    struct MatchConfig {
        uint8 gameMode;
        uint16 durationMinutes;
        uint64 kickoff;
    }

    error InvalidMatchId();
    error InvalidQuestionId();

    /// Layout: magic(4) | version(1) | gameMode(1) | durationMinutes(2) |
    /// kickoffUnixSeconds(8) | uniqueNonce(16). All integers are big-endian.
    function decodeMatch(bytes32 matchId) internal pure returns (MatchConfig memory config) {
        uint256 value = uint256(matchId);
        if (bytes4(matchId) != MATCH_MAGIC || uint8(value >> 216) != VERSION) revert InvalidMatchId();
        config.gameMode = uint8(value >> 208);
        config.durationMinutes = uint16(value >> 192);
        config.kickoff = uint64(value >> 128);
        if (config.gameMode == 0 || config.durationMinutes == 0 || config.kickoff == 0 || uint128(value) == 0) {
            revert InvalidMatchId();
        }
    }

    /// Layout: magic(4) | version(1) | kind(1) | subject(26).
    /// kind=1 is one member of the linked "which agent wins" set. Other kinds
    /// are independent propositions even when they share the same matchId.
    function questionKind(bytes32 questionId) internal pure returns (uint8 kind) {
        uint256 value = uint256(questionId);
        if (bytes4(questionId) != QUESTION_MAGIC || uint8(value >> 216) != VERSION || uint208(value) == 0) {
            revert InvalidQuestionId();
        }
        kind = uint8(value >> 208);
        if (kind == 0) revert InvalidQuestionId();
    }

    function marketId(address factory, bytes32 matchId, bytes32 questionId) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, factory, matchId, questionId));
    }
}
