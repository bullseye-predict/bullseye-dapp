// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PredictionTypes} from "./PredictionTypes.sol";

interface IAgentFillHook {
    function onOrderFilled(
        PredictionTypes.Order calldata order,
        bytes calldata signature,
        uint128 fillAmount,
        uint256 collateralAmount
    ) external;
}
