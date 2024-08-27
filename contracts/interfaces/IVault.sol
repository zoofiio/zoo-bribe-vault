// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../libs/Constants.sol";

interface IVault {

  function currentEpochId() external view returns (uint256);

  function epochInfoById(uint256 epochId) external view returns (Constants.Epoch memory);

  function assetToken() external view returns (address);

  function assetBalance() external view returns (uint256);

  function pToken() external view returns (address);

  function paramValue(bytes32 param) external view returns (uint256);

  function yTokenTotalSupply(uint256 epochId) external view returns (uint256);

  function yTokenUserBalance(uint256 epochId, address user) external view returns (uint256);

  function epochLastSwapTimestamp(uint256 epochId) external view returns (uint256);

  function epochLastSwapPriceScaled(uint256 epochId) external view returns (uint256);

}