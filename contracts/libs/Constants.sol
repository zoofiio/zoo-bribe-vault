// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

library Constants {
  /**
   * @notice The address interpreted as native token of the chain.
   */
  address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  uint256 public constant PROTOCOL_DECIMALS = 10;

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

  enum VaultType {
    Volatile,
    Stable
  }

  enum VaultMode {
    Empty,
    Stability,
    AdjustmentBelowAARS,
    AdjustmentAboveAARU
  }

  struct VaultState {
    uint256 M_ETH;
    uint256 P_ETH;
    uint256 P_ETH_DECIMALS;
    uint256 M_USD_ETH;
    uint256 M_ETHx;
    uint256 aar;
    uint256 AART;
    uint256 AARS;
    uint256 AARU;
    uint256 AARC;
    uint256 AARDecimals;
    uint256 RateR;
    uint256 AARBelowSafeLineTime;
    uint256 AARBelowCircuitBreakerLineTime;
  }

  struct StableVaultState {
    uint256 M_USDC;
    uint256 P_USDC;
    uint256 P_USDC_DECIMALS;
    uint256 M_USD_USDC;
    uint256 M_USDCx;
    uint256 aar;
    // uint256 AART;
    uint256 AARS;
    // uint256 AARU;
    // uint256 AARC;
    uint256 AARDecimals;
    uint256 RateR;
    uint256 AARBelowSafeLineTime;
  }

}