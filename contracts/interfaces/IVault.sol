// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../libs/Constants.sol";

interface IVault {

  function vaultType() external pure returns (Constants.VaultType);

  function AARDecimals() external pure returns (uint256);

  function usdToken() external view returns (address);

  function assetToken() external view returns (address);

  function assetTokenDecimals() external view returns (uint8);

  function assetTokenPrice() external view returns (uint256, uint256);

  function assetBalance() external view returns (uint256);

  function usdTotalSupply() external view returns (uint256);

  function marginToken() external view returns (address);

  function vaultMode() external view returns (Constants.VaultMode);

  function paramValue(bytes32 param) external view returns (uint256);

  function AARBelowSafeLineTime() external view returns (uint256);

  function AARBelowCircuitBreakerLineTime() external view returns (uint256);
}