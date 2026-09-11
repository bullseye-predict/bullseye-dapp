// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @notice Shared complete-set positions. Only the immutable settlement can mint or burn.
contract OutcomeToken is ERC1155 {
    address public immutable settlement;
    error OnlySettlement();

    constructor(address settlement_) ERC1155("") {
        settlement = settlement_;
    }

    modifier onlySettlement() {
        if (msg.sender != settlement) revert OnlySettlement();
        _;
    }

    function tokenId(bytes32 marketId, uint8 outcomeId) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(marketId, outcomeId)));
    }

    function mintSet(address to, bytes32 marketId, uint8 count, uint256 amount) external onlySettlement {
        (uint256[] memory ids, uint256[] memory amounts) = _set(marketId, count, amount);
        _mintBatch(to, ids, amounts, "");
    }

    function burnSet(address from, bytes32 marketId, uint8 count, uint256 amount) external onlySettlement {
        (uint256[] memory ids, uint256[] memory amounts) = _set(marketId, count, amount);
        _burnBatch(from, ids, amounts);
    }

    function burn(address from, bytes32 marketId, uint8 outcomeId, uint256 amount) external onlySettlement {
        _burn(from, tokenId(marketId, outcomeId), amount);
    }

    function burnPositions(address from, bytes32 marketId, uint256[] calldata amounts) external onlySettlement {
        uint256[] memory ids = new uint256[](amounts.length);
        for (uint256 i; i < amounts.length; ++i) ids[i] = tokenId(marketId, uint8(i));
        _burnBatch(from, ids, amounts);
    }

    function _set(bytes32 marketId, uint8 count, uint256 amount)
        private pure returns (uint256[] memory ids, uint256[] memory amounts)
    {
        ids = new uint256[](count);
        amounts = new uint256[](count);
        for (uint8 i; i < count; ++i) {
            ids[i] = tokenId(marketId, i);
            amounts[i] = amount;
        }
    }
}
