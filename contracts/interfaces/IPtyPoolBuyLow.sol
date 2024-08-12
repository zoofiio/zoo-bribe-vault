// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "./IPtyPool.sol";

interface IPtyPoolBuyLow is IPtyPool {

  function notifyBuyLowTriggered(uint256 assetAmountAdded) external;

}