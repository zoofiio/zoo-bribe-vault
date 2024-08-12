// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

interface IPriceFeed {
  /**
   * @notice The number of decimals in the returned price
   */
  function decimals() external view returns (uint8);

  /**
   * @notice Returns the latest price of the asset in USD
   */
  function latestPrice() external view returns (uint256);
}