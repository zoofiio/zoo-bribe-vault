// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "./IPtyPool.sol";

interface IPtyPoolSellHigh is IPtyPool {

  function notifySellHighTriggered(uint256 assetAmountMatched, uint256 usdSharesReceived, address assetRecipient) external;

}