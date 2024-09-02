// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../libs/Constants.sol";

interface IVault {

  function settings() external view returns (address);

  function currentEpochId() external view returns (uint256);

  function epochInfoById(uint256 epochId) external view returns (Constants.Epoch memory);

  function assetToken() external view returns (address);

  function assetBalance() external view returns (uint256);

  function pToken() external view returns (address);

  function paramValue(bytes32 param) external view returns (uint256);

  function yTokenTotalSupply(uint256 epochId) external view returns (uint256);

  function yTokenUserBalance(uint256 epochId, address user) external view returns (uint256);

  function yTokenTotalSupplySynthetic(uint256 epochId) external view returns (uint256);

  function yTokenUserBalanceSynthetic(uint256 epochId, address user) external view returns (uint256);

  function bribeTokens(uint256 epochId) external view returns (address[] memory);

  function bribeTotalAmount(uint256 epochId, address bribeToken) external view returns (uint256);

  function epochLastSwapTimestampF0(uint256 epochId) external view returns (uint256);

  function epochLastSwapPriceScaledF0(uint256 epochId) external view returns (uint256);

  function epochLastSwapTimestampF1(uint256 epochId) external view returns (uint256);

  function epochLastMintKtF1(uint256 epochId) external view returns (uint256);

}