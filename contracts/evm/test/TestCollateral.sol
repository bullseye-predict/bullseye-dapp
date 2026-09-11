// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PredictionMarket} from "../PredictionMarket.sol";

contract TestCollateral is ERC20 {
    bool public chargeFee;
    constructor() ERC20("Test collateral", "TUSD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setChargeFee(bool enabled) external { chargeFee = enabled; }
    function _update(address from, address to, uint256 amount) internal override {
        if (chargeFee && from != address(0) && to != address(0) && amount > 0) {
            super._update(from, address(0), 1);
            super._update(from, to, amount - 1);
        } else super._update(from, to, amount);
    }
}

/// @dev Receiver attempts a nested exit during the mint callback; failure must leave the split valid.
contract ReentrantReceiver is IERC1155Receiver {
    PredictionMarket public immutable settlement;
    bytes32 public marketId;
    bool public reentrySucceeded;
    constructor(PredictionMarket settlement_) { settlement = settlement_; }
    function split(bytes32 marketId_, IERC20 collateral, uint256 amount) external {
        marketId = marketId_;
        collateral.approve(address(settlement), amount);
        settlement.split(marketId, amount);
    }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata amounts, bytes calldata) external returns (bytes4) {
        (reentrySucceeded,) = address(settlement).call(abi.encodeCall(PredictionMarket.merge, (marketId, amounts[0])));
        return this.onERC1155BatchReceived.selector;
    }
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC1155Receiver).interfaceId || id == type(IERC165).interfaceId;
    }
}
