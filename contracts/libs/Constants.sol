// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

library Constants {
  /**
   * @notice The address interpreted as native token of the chain.
   */
  address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  uint256 public constant PROTOCOL_DECIMALS = 10;

  uint256 public constant SCALE_FACTOR = 10 ** PROTOCOL_DECIMALS;

  struct Epoch {
    uint256 epochId;
    uint256 startTime;
    uint256 duration;
    address redeemPool;
  }

  struct SwapForYTokensArgs {
    uint256 deltaT;
    uint256 D;
    uint256 T;
    uint256 t;
    uint256 t0;
    uint256 M;
    uint256 S;
    uint256 e1;
    uint256 e2;

    uint256 a_scaled;
    uint256 P_floor_scaled;
    uint256 P_scaled;
    uint256 A;
    uint256 B;
    uint256 C;
    uint256 Y;
  }

}