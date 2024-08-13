// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

library Constants {
  /**
   * @notice The address interpreted as native token of the chain.
   */
  address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  uint256 public constant PROTOCOL_DECIMALS = 10;

  // string public constant YT_NAME_PREFIX = "Zoo ";
  // string public constant YT_SYMBOL_PREFIX = "SY-";

  struct Epoch {
    uint256 epochId;
    uint256 startTime;
    uint256 duration;
    address yToken;
  }

  struct RedeemByPToken {
    address pToken;
    uint256 claimablePTokenShares;
    uint256 lockedPTokenShares;
    uint256 unlockTime;
  }
}