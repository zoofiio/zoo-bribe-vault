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

  struct SwapResultF0 {
    uint256 deltaT;
    uint256 D;
    uint256 T;
    uint256 t;
    uint256 t0;
    uint256 M;
    uint256 S;
    uint256 e1;
    uint256 e2;

    uint256 APRi;
    uint256 APRl;
    uint256 a_scaled;
    uint256 P_floor_scaled;
    uint256 P_scaled;
    bool P_scaled_positive;
    uint256 A;
    uint256 B;
    uint256 C;
    uint256 X;
    uint256 Y;
  }

  // struct SwapResultF1 {
  //   uint256 D;
  //   uint256 APRi;
  //   uint256 t;
  //   uint256 t0;
  //   uint256 deltaT;

  //   uint256 k0;
  //   uint256 S;
  //   uint256 X;
  //   uint256 Y;
  //   uint256 n;
  //   uint256 m;
  // }

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