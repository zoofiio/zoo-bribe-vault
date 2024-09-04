// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

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
  }

  struct BribeInfo {
    uint256 epochId;
    address bribeToken;
    uint256 bribeAmount;
  }

  struct Terms {
    uint256 T1;
    uint256 T2;
    uint256 T3;
    uint256 T4;
    uint256 T5;
    uint256 T6;
    uint256 T7;
    uint256 T8;
  }

}