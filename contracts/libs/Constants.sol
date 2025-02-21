// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

library Constants {
  /**
   * @notice The address interpreted as native token of the chain.
   */
  address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  uint256 public constant PROTOCOL_DECIMALS = 10;

  struct Epoch {
    uint256 epochId;
    uint256 startTime;
    uint256 duration;
    address redeemPool;
    address stakingBribesPool;
    address adhocBribesPool;
  }

  struct BribeInfo {
    uint256 epochId;
    address bribeToken;
    uint256 bribeAmount;
  }

}