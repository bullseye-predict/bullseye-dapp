// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {PredictionMarket} from "./PredictionMarket.sol";
import {PredictionTypes} from "./interfaces/PredictionTypes.sol";

/// @notice Relays domain-bound results signed by the configured SOLZ authority.
/// @dev MVP trust model: one configured authority (EOA or ERC1271 multisig), immediate finality.
contract ResultOracle is Ownable2Step, EIP712 {
    bytes32 public constant RESULT_TYPEHASH = keccak256(
        "Result(bytes32 matchId,bytes32 marketId,uint8 winningOutcomeId,bool voided,bytes32 stateHash,uint64 finishedAt,uint64 expiry)"
    );
    PredictionMarket public immutable settlement;
    address public authority;
    error InvalidAuthority();
    error InvalidResult();
    event AuthorityChanged(address indexed previousAuthority, address indexed authority);
    event ResultAccepted(bytes32 indexed marketId, bytes32 indexed matchId, bytes32 indexed digest, bytes32 stateHash);

    constructor(address initialOwner, address authority_, PredictionMarket settlement_)
        Ownable(initialOwner) EIP712("SOLZ Result Oracle", "1")
    {
        if (address(settlement_).code.length == 0) revert InvalidAuthority();
        settlement = settlement_;
        _setAuthority(authority_);
    }

    function resolveMarket(PredictionTypes.Result calldata result, bytes calldata signature) external {
        if (result.expiry <= block.timestamp || result.finishedAt > block.timestamp || result.expiry < result.finishedAt
            || result.stateHash == bytes32(0) || (result.voided && result.winningOutcomeId != 0)) revert InvalidResult();
        bytes32 digest = hashResult(result);
        if (!SignatureChecker.isValidSignatureNow(authority, digest, signature)) revert InvalidAuthority();
        settlement.finalize(result);
        emit ResultAccepted(result.marketId, result.matchId, digest, result.stateHash);
    }

    function hashResult(PredictionTypes.Result memory result) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            RESULT_TYPEHASH, result.matchId, result.marketId, result.winningOutcomeId, result.voided,
            result.stateHash, result.finishedAt, result.expiry
        )));
    }

    function setAuthority(address authority_) external onlyOwner { _setAuthority(authority_); }

    function _setAuthority(address authority_) private {
        if (authority_ == address(0) || authority_ == address(this)) revert InvalidAuthority();
        emit AuthorityChanged(authority, authority_);
        authority = authority_;
    }
}
